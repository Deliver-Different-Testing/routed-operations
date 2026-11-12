// Implementation of IBranchScopeGuard. See the interface header for the rule.
//
// Address arm: tucJob.UcjbFrom / UcjbTo -> tucSuburb.UcsuID -> SiteId ->
// tblBranch.SiteId (active branches only).
//
// Family links used (all on tucJob):
//   root(job)  = RootParentId ?? ParentId ?? ucjbID
//   members(r) = tucJob rows with ucjbID = r OR ParentID = r OR RootParentId = r
// Run links: tblBulkJob.JobID -> tucJob.ucjbID; tblBulkJobRun(BulkJobID, RunID)
// -> tblBulkRun.Id / CourierId; synthetic route runs (negative ids) use
// tucJob.RouteId and Routes.DefaultCourierId.
//
// The per-leg predicate is BranchRowFilter.IsJobVisible (client or courier);
// this class only fetches rows and applies it across a family.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Branches;

public class BranchScopeGuard(
    IBranchScopeResolver scopeResolver,
    IDbContextFactory<DynamicDespatchDbContext> contextFactory) : IBranchScopeGuard
{
    // Scoped lifetime = one request, so the visible-id sets load once.
    private BranchRowFilter? _filter;

    public async Task<BranchRowFilter> GetRowFilterAsync()
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return BranchRowFilter.Unrestricted;
        if (_filter is not null) return _filter;

        await using var context = await contextFactory.CreateDbContextAsync();
        return await LoadFilterAsync(context, scope);
    }

    public async Task<IReadOnlySet<int>> VisibleJobIdsAsync(IReadOnlyCollection<int> jobIds)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return jobIds.ToHashSet();

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);
        return await VisibleJobIdsAsync(context, filter, jobIds);
    }

    public async Task<IReadOnlySet<int>> VisibleRunIdsAsync(IReadOnlyCollection<int> runIds)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return runIds.ToHashSet();

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);

        // Batched (the board lists every run of the day): one query per
        // source, then one family expansion over every job id.
        var bulkRunIds = runIds.Where(r => r > 0).Distinct().ToList();
        var routeIds = runIds.Where(r => r < 0).Select(r => (int?)(-r)).Distinct().ToList();
        var routeIdValues = routeIds.Select(r => r!.Value).ToList();

        var runCouriers = await context.TblBulkRuns
            .Where(r => bulkRunIds.Contains(r.Id))
            .Select(r => new { r.Id, r.CourierId })
            .ToListAsync();
        var bulkRunIdsNullable = bulkRunIds.Select(i => (int?)i).ToList();
        var runJobs = await (
            from jr in context.TblBulkJobRuns.Where(jr => bulkRunIdsNullable.Contains(jr.RunId))
            join b in context.TblBulkJobs on jr.BulkJobId equals b.BulkJobId
            join j in context.TucJobs on b.JobId equals j.UcjbId
            select new { RunId = jr.RunId!.Value, JobId = j.UcjbId }
        ).Distinct().ToListAsync();
        var routeJobs = await context.TucJobs
            .Where(j => routeIds.Contains(j.RouteId) && !j.UcjbVoid)
            .Select(j => new { RouteId = j.RouteId!.Value, j.UcjbId, j.UcjbCourierId })
            .ToListAsync();
        var routeCouriers = await context.Routes
            .Where(r => routeIdValues.Contains(r.RouteId))
            .Select(r => new { r.RouteId, r.DefaultCourierId })
            .ToListAsync();

        var visibleJobs = await VisibleJobIdsAsync(context, filter,
            runJobs.Select(x => x.JobId).Concat(routeJobs.Select(x => x.UcjbId)).Distinct().ToList());

        var visible = new HashSet<int>();
        foreach (var r in runCouriers.Where(r => r.CourierId.HasValue && filter.IsCourierVisible(r.CourierId)))
            visible.Add(r.Id);
        foreach (var x in runJobs.Where(x => visibleJobs.Contains(x.JobId)))
            visible.Add(x.RunId);
        foreach (var r in routeCouriers.Where(r => r.DefaultCourierId.HasValue && filter.IsCourierVisible(r.DefaultCourierId)))
            visible.Add(-r.RouteId);
        foreach (var x in routeJobs.Where(x => visibleJobs.Contains(x.UcjbId)
                     || (x.UcjbCourierId.HasValue && filter.IsCourierVisible(x.UcjbCourierId))))
            visible.Add(-x.RouteId);
        return visible;
    }

    public async Task<bool> IsRunFullyVisibleAsync(int runId)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return true;

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);
        return await IsRunFullyVisibleAsync(context, filter, runId);
    }

    public async Task EnsureTucJobInScopeAsync(int jobId)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);

        // A missing job is not in the visible set, so it throws (NP parity).
        if (!(await VisibleJobIdsAsync(context, filter, new[] { jobId })).Contains(jobId))
            throw new BranchScopeException($"tucJob {jobId} is outside your branches.");
    }

    public async Task EnsureBulkJobInScopeAsync(int bulkJobId)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);

        var bulk = await context.TblBulkJobs
            .Where(b => b.BulkJobId == bulkJobId)
            .Select(b => new { b.JobId, b.ClientId, b.CourierId })
            .FirstOrDefaultAsync();
        if (bulk is null)
            throw new BranchScopeException($"tblBulkJob {bulkJobId} is outside your branches.");

        bool visible;
        if (bulk.JobId.HasValue && await context.TucJobs.AnyAsync(j => j.UcjbId == bulk.JobId.Value))
        {
            // Live job: tucJob is the source of truth, expanded to its family.
            visible = (await VisibleJobIdsAsync(context, filter, new[] { bulk.JobId.Value })).Contains(bulk.JobId.Value);
        }
        else
        {
            // Not live yet: the bulk job's own client / courier, or the courier
            // of a run it is already on.
            visible = filter.IsJobVisible(bulk.ClientId, bulk.CourierId)
                || (await RunCouriersForBulkJobsAsync(context, new[] { bulkJobId }))
                    .Any(x => filter.IsCourierVisible(x.CourierId));
        }

        if (!visible)
            throw new BranchScopeException($"tblBulkJob {bulkJobId} is outside your branches.");
    }

    public async Task EnsureTucJobByNumberInScopeAsync(string jobNumber)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);

        // Every tucJob row with the number must be visible (NP parity).
        var ids = await context.TucJobs
            .Where(j => j.UcjbNumber == jobNumber)
            .Select(j => j.UcjbId)
            .ToListAsync();
        if (ids.Count == 0) return;

        var visible = await VisibleJobIdsAsync(context, filter, ids);
        if (ids.Any(id => !visible.Contains(id)))
            throw new BranchScopeException($"Job number '{jobNumber}' is outside your branches.");
    }

    public async Task EnsureRouteInScopeAsync(int routeId)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);

        if (!await IsRunFullyVisibleAsync(context, filter, -routeId))
            throw new BranchScopeException($"Route {routeId} has jobs outside your branches.");
    }

    public async Task EnsureRunInScopeAsync(int runId)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);

        if (!await IsRunFullyVisibleAsync(context, filter, runId))
            throw new BranchScopeException(runId < 0
                ? $"Route {-runId} has jobs outside your branches."
                : $"Run {runId} has jobs outside your branches.");
    }

    // ---- internals ----

    private async Task<bool> IsRunFullyVisibleAsync(DynamicDespatchDbContext context, BranchRowFilter filter, int runId)
    {
        var (courierVisible, jobIds) = await RunCourierAndJobsAsync(context, filter, runId);
        if (courierVisible) return true;
        if (jobIds.Count == 0) return true; // nothing on it to leak (NP parity)
        var visible = await VisibleJobIdsAsync(context, filter, jobIds);
        return jobIds.All(visible.Contains);
    }

    /// <summary>Whether the run's courier is visible, and the live tucJob ids on it.
    /// Negative id = synthetic route run (route id = -runId).</summary>
    private static async Task<(bool CourierVisible, List<int> JobIds)> RunCourierAndJobsAsync(
        DynamicDespatchDbContext context, BranchRowFilter filter, int runId)
    {
        if (runId < 0)
        {
            var routeId = -runId;
            var jobs = await context.TucJobs
                .Where(j => j.RouteId == routeId && !j.UcjbVoid)
                .Select(j => new { j.UcjbId, j.UcjbCourierId })
                .ToListAsync();
            var defaultCourier = await context.Routes
                .Where(r => r.RouteId == routeId)
                .Select(r => r.DefaultCourierId)
                .FirstOrDefaultAsync();
            var courierVisible = filter.IsCourierVisible(defaultCourier)
                || jobs.Any(j => j.UcjbCourierId.HasValue && filter.IsCourierVisible(j.UcjbCourierId));
            return (courierVisible, jobs.Select(j => j.UcjbId).ToList());
        }

        var runCourier = await context.TblBulkRuns
            .Where(r => r.Id == runId)
            .Select(r => r.CourierId)
            .FirstOrDefaultAsync();
        var jobIds = await (
            from jr in context.TblBulkJobRuns.Where(jr => jr.RunId == runId)
            join b in context.TblBulkJobs on jr.BulkJobId equals b.BulkJobId
            join j in context.TucJobs on b.JobId equals j.UcjbId
            select j.UcjbId
        ).Distinct().ToListAsync();
        return (runCourier.HasValue && filter.IsCourierVisible(runCourier), jobIds);
    }

    private sealed class FamilyLeg
    {
        public int JobId { get; init; }
        public int? ParentId { get; init; }
        public int? RootParentId { get; init; }
        public int? ClientId { get; init; }
        public int? CourierId { get; init; }
        public int? FromSiteId { get; init; }
        public int? ToSiteId { get; init; }
    }

    private static int RootOf(int jobId, int? parentId, int? rootParentId) => rootParentId ?? parentId ?? jobId;

    /// <summary>Of the anchors, the tucJob ids whose job family has at least
    /// one visible leg (client, leg courier, pickup / delivery suburb site, or
    /// courier of a run a leg is on).</summary>
    private static async Task<HashSet<int>> VisibleJobIdsAsync(
        DynamicDespatchDbContext context, BranchRowFilter filter, IReadOnlyCollection<int> anchorIds)
    {
        var result = new HashSet<int>();
        if (anchorIds.Count == 0) return result;
        var anchorList = anchorIds.Distinct().ToList();

        var anchors = await context.TucJobs
            .Where(j => anchorList.Contains(j.UcjbId))
            .Select(j => new { j.UcjbId, j.ParentId, j.RootParentId })
            .ToListAsync();
        if (anchors.Count == 0) return result;

        var rootByAnchor = anchors.ToDictionary(a => a.UcjbId, a => RootOf(a.UcjbId, a.ParentId, a.RootParentId));
        var roots = rootByAnchor.Values.Distinct().ToList();

        var legs = await context.TucJobs
            .Where(j => roots.Contains(j.UcjbId)
                || (j.ParentId != null && roots.Contains(j.ParentId.Value))
                || (j.RootParentId != null && roots.Contains(j.RootParentId.Value)))
            .Select(j => new FamilyLeg
            {
                JobId = j.UcjbId,
                ParentId = j.ParentId,
                RootParentId = j.RootParentId,
                ClientId = j.UcjbClientId,
                CourierId = j.UcjbCourierId,
                // Pickup / delivery suburb -> site (tucSuburb.SiteId).
                FromSiteId = context.TucSuburbs.Where(su => su.UcsuId == j.UcjbFrom).Select(su => su.SiteId).FirstOrDefault(),
                ToSiteId = context.TucSuburbs.Where(su => su.UcsuId == j.UcjbTo).Select(su => su.SiteId).FirstOrDefault(),
            })
            .ToListAsync();

        // Couriers of the runs any leg sits on (a pre-assigned run can carry
        // the courier before the leg itself is despatched).
        var legIds = legs.Select(l => l.JobId).ToList();
        var runCourierLegs = await (
            from b in context.TblBulkJobs.Where(b => b.JobId != null && legIds.Contains(b.JobId.Value))
            join jr in context.TblBulkJobRuns on b.BulkJobId equals jr.BulkJobId
            join r in context.TblBulkRuns on jr.RunId equals r.Id
            where r.CourierId != null
            select new { JobId = b.JobId!.Value, r.CourierId }
        ).ToListAsync();
        var legsOnVisibleRun = runCourierLegs
            .Where(x => filter.IsCourierVisible(x.CourierId))
            .Select(x => x.JobId)
            .ToHashSet();

        var visibleRoots = new HashSet<int>();
        foreach (var root in roots)
        {
            var family = legs.Where(l => l.JobId == root || l.ParentId == root || l.RootParentId == root);
            if (family.Any(l => filter.IsLegVisible(l.ClientId, l.CourierId, l.FromSiteId, l.ToSiteId) || legsOnVisibleRun.Contains(l.JobId)))
                visibleRoots.Add(root);
        }

        foreach (var (anchor, root) in rootByAnchor)
            if (visibleRoots.Contains(root)) result.Add(anchor);
        return result;
    }

    private static async Task<List<(int BulkJobId, int? CourierId)>> RunCouriersForBulkJobsAsync(
        DynamicDespatchDbContext context, IReadOnlyCollection<int> bulkJobIds)
    {
        var ids = bulkJobIds.ToList();
        var rows = await (
            from jr in context.TblBulkJobRuns.Where(jr => jr.BulkJobId != null && ids.Contains(jr.BulkJobId.Value))
            join r in context.TblBulkRuns on jr.RunId equals r.Id
            select new { BulkJobId = jr.BulkJobId!.Value, r.CourierId }
        ).ToListAsync();
        return rows.Select(r => (r.BulkJobId, r.CourierId)).ToList();
    }

    private async Task<BranchRowFilter> LoadFilterAsync(DynamicDespatchDbContext context, BranchScope scope)
    {
        if (_filter is not null) return _filter;

        var ids = scope.BranchIds.ToArray();
        var defaultInScope = ids.Length > 0
            && await context.TblBranches.AnyAsync(b => b.IsDefault && ids.Contains(b.BranchId));

        var clientIds = await context.TucClients
            .Where(BranchPredicates.ClientVisible(ids, defaultInScope))
            .Select(c => c.UcclId)
            .ToListAsync();
        var courierIds = await context.TucCouriers
            .Where(BranchPredicates.CourierVisible(ids, defaultInScope))
            .Select(c => c.UccrId)
            .ToListAsync();

        // Sites of the caller's ACTIVE branches (address arm, section 4.1).
        var siteIds = await context.TblBranches
            .Where(b => b.Active && b.SiteId != null && ids.Contains(b.BranchId))
            .Select(b => b.SiteId!.Value)
            .ToListAsync();

        _filter = BranchRowFilter.Restricted(clientIds, courierIds, siteIds);
        return _filter;
    }
}
