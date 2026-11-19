using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.Branches;

// Implementation of IBranchScopeGuard. Visibility is worked out from the ids actually involved (the jobs, clients and
// couriers on the rows in hand), never by loading every client the caller may see, so it stays cheap on a large tenant.
public class BranchScopeGuard(
    IBranchScopeResolver resolver,
    IDbContextFactory<DynamicDespatchDbContext> contextFactory) : IBranchScopeGuard
{
    // tucClient.ClientTypeId values every branch-limited staff member still sees: 1 internal, 4 tenant, 5 DF Admin.
    // Keyed on ClientTypeId, never on the ucclInternal billing flag.
    private static readonly int[] HouseClientTypeIds = [1, 4, 5];

    private BranchContext? _branch;

    public bool IsRestricted => resolver.Resolve().IsRestricted;

    public int[] BranchIds => [.. resolver.Resolve().BranchIds];

    private bool? _defaultInScope;

    public bool DefaultBranchInScope
    {
        get
        {
            if (!IsRestricted) return false;
            if (_defaultInScope is { } known) return known;
            var ids = BranchIds;
            using var context = contextFactory.CreateDbContext();
            return (_defaultInScope = ids.Length > 0 && context.TblBranches.Any(b => b.IsDefault && ids.Contains(b.BranchId))).Value;
        }
    }

    // What the caller's branches mean in data terms, read once per request: whether the default branch is theirs (a client
    // or courier with no branch belongs to it) and the sites of their ACTIVE branches.
    // ParentJobCourierId: the system courier split parents are parked on (tblSetting.ParentJobCourierId). It has no branch, so the courier
    // arm would treat it as the default branch's courier and make every split family visible to the default branch. As a JOB-visibility
    // link it counts for nothing; as a courier on a run, or in a picker, nothing changes.
    private sealed record BranchContext(int[] BranchIds, bool DefaultInScope, int[] SiteIds, int? ParentJobCourierId);

    private async Task<BranchContext> BranchContextAsync(DynamicDespatchDbContext context)
    {
        if (_branch is not null) return _branch;

        var ids = resolver.Resolve().BranchIds.ToArray();
        if (ids.Length == 0) return _branch = new BranchContext(ids, false, [], null);

        var rows = await context.TblBranches
            .Where(b => b.IsDefault || ids.Contains(b.BranchId))
            .Select(b => new { b.BranchId, b.IsDefault, b.Active, b.SiteId })
            .ToListAsync();
        var parentCourier = await context.TblSettings.Select(s => s.ParentJobCourierId).FirstOrDefaultAsync();

        return _branch = new BranchContext(
            ids,
            rows.Any(b => b.IsDefault && ids.Contains(b.BranchId)),
            [.. rows.Where(b => b.Active && b.SiteId != null && ids.Contains(b.BranchId)).Select(b => b.SiteId!.Value).Distinct()],
            parentCourier is > 0 ? parentCourier : null);
    }

    // ---- id sets ----

    private static async Task<HashSet<int>> ClientsAsync(DynamicDespatchDbContext context, BranchContext b, IEnumerable<int> ids)
    {
        var wanted = ids.Distinct().ToList();
        if (wanted.Count == 0) return [];
        var branchIds = b.BranchIds;
        var defaultInScope = b.DefaultInScope;
        return [.. await context.TucClients
            .Where(c => wanted.Contains(c.UcclId)
                        && ((c.BranchId != null && branchIds.Contains(c.BranchId.Value))
                            || (c.BranchId == null && defaultInScope)
                            || HouseClientTypeIds.Contains(c.ClientTypeId)))
            .Select(c => c.UcclId)
            .ToListAsync()];
    }

    // forJobs: the courier is being used as a link that makes a JOB visible, so the parent-job placeholder courier is dropped.
    private static async Task<HashSet<int>> CouriersAsync(DynamicDespatchDbContext context, BranchContext b, IEnumerable<int> ids, bool forJobs = false)
    {
        var wanted = ids.Where(i => !(forJobs && i == b.ParentJobCourierId)).Distinct().ToList();
        if (wanted.Count == 0) return [];
        var branchIds = b.BranchIds;
        var defaultInScope = b.DefaultInScope;
        return [.. await context.TucCouriers
            .Where(r => wanted.Contains(r.UccrId)
                        && ((r.BranchId != null && branchIds.Contains(r.BranchId.Value))
                            || (r.BranchId == null && defaultInScope)))
            .Select(r => r.UccrId)
            .ToListAsync()];
    }

    private static async Task<HashSet<int>> SuburbsOnTheirSitesAsync(DynamicDespatchDbContext context, BranchContext b, IEnumerable<int> ids)
    {
        var wanted = ids.Distinct().ToList();
        if (wanted.Count == 0 || b.SiteIds.Length == 0) return [];
        var sites = b.SiteIds;
        return [.. await context.TucSuburbs
            .Where(s => wanted.Contains(s.UcsuId) && s.SiteId != null && sites.Contains(s.SiteId.Value))
            .Select(s => s.UcsuId)
            .ToListAsync()];
    }

    // ---- job families ----

    private sealed record Leg(int Id, int? ParentId, int? RootParentId, int? ClientId, int? CourierId, int? From, int? To);

    private static int FamilyRoot(int id, int? parentId, int? rootParentId) => rootParentId ?? parentId ?? id;

    private async Task<HashSet<int>> VisibleJobIdsCoreAsync(DynamicDespatchDbContext context, BranchContext b, IReadOnlyCollection<int> jobIds)
    {
        var wanted = jobIds.Where(i => i > 0).Distinct().ToList();
        if (wanted.Count == 0) return [];

        // 1. The family root of each requested job.
        var starts = await context.TucJobs
            .Where(j => wanted.Contains(j.UcjbId))
            .Select(j => new { j.UcjbId, j.ParentId, j.RootParentId })
            .ToListAsync();
        var rootOf = starts.ToDictionary(s => s.UcjbId, s => FamilyRoot(s.UcjbId, s.ParentId, s.RootParentId));
        var roots = rootOf.Values.Distinct().ToList();
        if (roots.Count == 0) return [];

        // 2. Every leg of those families: the root itself and any job pointing at it.
        var legs = await context.TucJobs
            .Where(j => roots.Contains(j.UcjbId)
                        || (j.ParentId != null && roots.Contains(j.ParentId.Value))
                        || (j.RootParentId != null && roots.Contains(j.RootParentId.Value)))
            .Select(j => new Leg(j.UcjbId, j.ParentId, j.RootParentId, j.UcjbClientId, j.UcjbCourierId, j.UcjbFrom, j.UcjbTo))
            .ToListAsync();

        // 3. Which of the legs' clients, couriers and suburbs are the caller's.
        var clients = await ClientsAsync(context, b, legs.Where(l => l.ClientId != null).Select(l => l.ClientId!.Value));
        var couriers = await CouriersAsync(context, b, legs.Where(l => l.CourierId != null).Select(l => l.CourierId!.Value), forJobs: true);
        var suburbs = await SuburbsOnTheirSitesAsync(context, b,
            legs.SelectMany(l => new[] { l.From, l.To }).Where(s => s != null).Select(s => s!.Value));

        bool LegVisible(Leg l) =>
            (l.ClientId != null && clients.Contains(l.ClientId.Value))
            || (l.CourierId != null && couriers.Contains(l.CourierId.Value))
            || (l.From != null && suburbs.Contains(l.From.Value))
            || (l.To != null && suburbs.Contains(l.To.Value));

        // 4. A family is visible when any of its legs is. A leg belongs to the family of its root and, by id, to its own.
        var visibleRoots = new HashSet<int>();
        foreach (var leg in legs.Where(LegVisible))
        {
            visibleRoots.Add(FamilyRoot(leg.Id, leg.ParentId, leg.RootParentId));
        }

        return [.. rootOf.Where(kv => visibleRoots.Contains(kv.Value)).Select(kv => kv.Key)];
    }

    public async Task<IReadOnlySet<int>> VisibleJobIdsAsync(IReadOnlyCollection<int> jobIds)
    {
        if (!IsRestricted) return jobIds.ToHashSet();
        await using var context = await contextFactory.CreateDbContextAsync();
        return await VisibleJobIdsCoreAsync(context, await BranchContextAsync(context), jobIds);
    }

    public async Task<IReadOnlySet<int>> VisibleBulkJobIdsAsync(IReadOnlyCollection<int> bulkJobIds)
    {
        if (!IsRestricted) return bulkJobIds.ToHashSet();
        var wanted = bulkJobIds.Where(i => i > 0).Distinct().ToList();
        if (wanted.Count == 0) return new HashSet<int>();

        await using var context = await contextFactory.CreateDbContextAsync();
        var b = await BranchContextAsync(context);
        var rows = await context.TblBulkJobs
            .Where(x => wanted.Contains(x.BulkJobId))
            .Select(x => new { x.BulkJobId, x.JobId, x.ClientId, x.CourierId })
            .ToListAsync();

        var jobs = await VisibleJobIdsCoreAsync(context, b, rows.Where(r => r.JobId != null).Select(r => r.JobId!.Value).ToList());
        var clients = await ClientsAsync(context, b, rows.Where(r => r.JobId == null).Select(r => r.ClientId));
        var couriers = await CouriersAsync(context, b, rows.Where(r => r.JobId == null && r.CourierId != null).Select(r => r.CourierId!.Value), forJobs: true);

        return rows.Where(r => r.JobId is { } j
                ? jobs.Contains(j)
                : clients.Contains(r.ClientId) || (r.CourierId is { } c && couriers.Contains(c)))
            .Select(r => r.BulkJobId).ToHashSet();
    }

    public async Task<IReadOnlySet<int>> ActionableBulkJobIdsAsync(IReadOnlyCollection<int> bulkJobIds)
    {
        if (!IsRestricted) return bulkJobIds.ToHashSet();
        var actionable = (await VisibleBulkJobIdsAsync(bulkJobIds)).ToHashSet();
        var rest = bulkJobIds.Where(i => i > 0 && !actionable.Contains(i)).Distinct().ToList();
        if (rest.Count == 0) return actionable;

        // One batch for every job and run involved (not a query set per run). A run that no longer exists (a stale pointer on the job)
        // counts for nothing: the job stands or falls on its own visibility, decided above.
        await using var context = await contextFactory.CreateDbContextAsync();
        var onRuns = await RunsOfJobsAsync(context, rest);
        var runIds = onRuns.Select(x => x.RunId).Distinct().ToList();
        if (runIds.Count == 0) return actionable;

        var ours = await RunsWithOwnCourierAsync(context, await BranchContextAsync(context), runIds);
        foreach (var j in onRuns.Where(x => ours.Contains(x.RunId))) actionable.Add(j.JobId);
        return actionable;
    }

    // The ONE definition of "which run is this job on": its tblBulkJobRun link, or, only when it has no link row, tblBulkJob.BulkRunId.
    private static async Task<List<(int JobId, int RunId)>> RunsOfJobsAsync(DynamicDespatchDbContext context, IReadOnlyCollection<int> jobIds)
    {
        var linked = await context.TblBulkJobRuns
            .Where(x => x.BulkJobId != null && jobIds.Contains(x.BulkJobId.Value) && x.RunId != null)
            .Select(x => new { JobId = x.BulkJobId!.Value, RunId = x.RunId!.Value })
            .ToListAsync();
        var linkedJobs = await context.TblBulkJobRuns
            .Where(x => x.BulkJobId != null && jobIds.Contains(x.BulkJobId.Value))
            .Select(x => x.BulkJobId!.Value)
            .ToListAsync();
        var direct = await context.TblBulkJobs
            .Where(j => jobIds.Contains(j.BulkJobId) && j.BulkRunId != null)
            .Select(j => new { JobId = j.BulkJobId, RunId = j.BulkRunId!.Value })
            .ToListAsync();

        return [.. linked.Select(x => (x.JobId, x.RunId))
            .Concat(direct.Where(x => !linkedJobs.Contains(x.JobId)).Select(x => (x.JobId, x.RunId)))
            .Distinct()];
    }

    // Of these tblBulkRun ids, the ones that exist and whose courier is the caller's (so the whole run is theirs).
    private static async Task<HashSet<int>> RunsWithOwnCourierAsync(DynamicDespatchDbContext context, BranchContext b, IReadOnlyCollection<int> runIds)
    {
        var real = runIds.Where(i => i > 0).Distinct().ToList();
        if (real.Count == 0) return [];
        var runs = await context.TblBulkRuns.Where(r => real.Contains(r.Id)).Select(r => new { r.Id, r.CourierId }).ToListAsync();
        var couriers = await CouriersAsync(context, b, runs.Where(r => r.CourierId != null).Select(r => r.CourierId!.Value));
        return [.. runs.Where(r => r.CourierId is { } c && couriers.Contains(c)).Select(r => r.Id)];
    }

    public async Task<IReadOnlySet<int>> VisibleClientIdsAsync(IReadOnlyCollection<int> clientIds)
    {
        if (!IsRestricted) return clientIds.ToHashSet();
        await using var context = await contextFactory.CreateDbContextAsync();
        return await ClientsAsync(context, await BranchContextAsync(context), clientIds);
    }

    public async Task<IQueryable<TucClient>> WhereClientVisibleAsync(IQueryable<TucClient> query)
    {
        if (!IsRestricted) return query;
        await using var context = await contextFactory.CreateDbContextAsync();
        var b = await BranchContextAsync(context);
        var branchIds = b.BranchIds;
        var defaultInScope = b.DefaultInScope;
        return query.Where(c => (c.BranchId != null && branchIds.Contains(c.BranchId.Value))
                                || (c.BranchId == null && defaultInScope)
                                || HouseClientTypeIds.Contains(c.ClientTypeId));
    }

    public async Task<IQueryable<TucCourier>> WhereCourierVisibleAsync(IQueryable<TucCourier> query)
    {
        if (!IsRestricted) return query;
        await using var context = await contextFactory.CreateDbContextAsync();
        var b = await BranchContextAsync(context);
        var branchIds = b.BranchIds;
        var defaultInScope = b.DefaultInScope;
        return query.Where(r => (r.BranchId != null && branchIds.Contains(r.BranchId.Value)) || (r.BranchId == null && defaultInScope));
    }

    public async Task<IReadOnlySet<int>> VisibleCourierIdsAsync(IReadOnlyCollection<int> courierIds)
    {
        if (!IsRestricted) return courierIds.ToHashSet();
        await using var context = await contextFactory.CreateDbContextAsync();
        return await CouriersAsync(context, await BranchContextAsync(context), courierIds);
    }

    public async Task<IReadOnlySet<int>> VisibleJobCourierIdsAsync(IReadOnlyCollection<int> courierIds)
    {
        if (!IsRestricted) return courierIds.ToHashSet();
        await using var context = await contextFactory.CreateDbContextAsync();
        return await CouriersAsync(context, await BranchContextAsync(context), courierIds, forJobs: true);
    }

    // ---- ensure (one row; a missing row is a denial, as the NP guard does) ----

    public async Task EnsureTucJobInScopeAsync(int jobId)
    {
        if (!IsRestricted) return;
        await using var context = await contextFactory.CreateDbContextAsync();
        var visible = await VisibleJobIdsCoreAsync(context, await BranchContextAsync(context), [jobId]);
        if (!visible.Contains(jobId))
            throw new BranchScopeException($"tucJob {jobId} is outside your branches.");
    }

    public async Task EnsureBulkJobInScopeAsync(int bulkJobId)
    {
        if (!IsRestricted) return;

        // One rule for reading and acting on a bulk job: it is visible, or it sits on a run whose courier is the caller's (the run
        // list shows every job on such a run, so opening or acting on one must work). A missing row is a denial.
        if (!(await ActionableBulkJobIdsAsync([bulkJobId])).Contains(bulkJobId))
            throw new BranchScopeException($"tblBulkJob {bulkJobId} is outside your branches.");
    }

    public async Task EnsureTucJobByNumberInScopeAsync(string jobNumber)
    {
        if (!IsRestricted) return;
        await using var context = await contextFactory.CreateDbContextAsync();
        var ids = await context.TucJobs.Where(j => j.UcjbNumber == jobNumber).Select(j => j.UcjbId).ToListAsync();

        // Every row carrying the number must be visible, and at least one must exist.
        var visible = ids.Count == 0 ? [] : await VisibleJobIdsCoreAsync(context, await BranchContextAsync(context), ids);
        if (ids.Count == 0 || ids.Any(i => !visible.Contains(i)))
            throw new BranchScopeException($"Job number '{jobNumber}' is outside your branches.");
    }

    // ---- routes and runs ----

    public async Task EnsureRouteInScopeAsync(int routeId)
    {
        if (!IsRestricted) return;
        await using var context = await contextFactory.CreateDbContextAsync();
        if (!await RouteFullyVisibleAsync(context, await BranchContextAsync(context), routeId))
            throw new BranchScopeException($"Route {routeId} is outside your branches.");
    }

    private async Task<bool> RouteFullyVisibleAsync(DynamicDespatchDbContext context, BranchContext b, int routeId)
    {
        var courierId = await context.Routes.Where(r => r.RouteId == routeId).Select(r => r.DefaultCourierId).FirstOrDefaultAsync();
        if (courierId is { } c && (await CouriersAsync(context, b, [c])).Count > 0) return true;

        var jobIds = await context.TucJobs.Where(j => j.RouteId == routeId && !j.UcjbVoid).Select(j => j.UcjbId).ToListAsync();
        if (jobIds.Count == 0) return false;
        var visible = await VisibleJobIdsCoreAsync(context, b, jobIds);
        return jobIds.All(visible.Contains);
    }

    // The jobs on each run (tucJob ids), plus any run job with no tucJob (judged by its own client / courier).
    private sealed record RunJobs(int? Courier, List<int> JobIds, List<(int ClientId, int? CourierId)> Unlinked);

    private async Task<Dictionary<int, RunJobs>> RunJobsAsync(DynamicDespatchDbContext context, IReadOnlyCollection<int> runIds)
    {
        var result = runIds.Distinct().ToDictionary(i => i, _ => new RunJobs(null, [], []));

        var real = runIds.Where(i => i > 0).Distinct().ToList();
        if (real.Count > 0)
        {
            foreach (var run in await context.TblBulkRuns.Where(r => real.Contains(r.Id)).Select(r => new { RunId = r.Id, r.CourierId }).ToListAsync())
                result[run.RunId] = result[run.RunId] with { Courier = run.CourierId };

            // A job is on a run by its tblBulkJobRun link or, when it has no link row at all, by tblBulkJob.BulkRunId (legacy rows):
            // the same definition RunsOfJobsAsync uses.
            var links = await (from jr in context.TblBulkJobRuns.Where(x => x.RunId != null && real.Contains(x.RunId.Value))
                               join bj in context.TblBulkJobs on jr.BulkJobId equals bj.BulkJobId
                               select new { RunId = jr.RunId!.Value, bj.BulkJobId, bj.JobId, bj.ClientId, bj.CourierId }).ToListAsync();
            var direct = await context.TblBulkJobs
                .Where(bj => bj.BulkRunId != null && real.Contains(bj.BulkRunId.Value)
                             && !context.TblBulkJobRuns.Any(x => x.BulkJobId == bj.BulkJobId))
                .Select(bj => new { RunId = bj.BulkRunId!.Value, bj.BulkJobId, bj.JobId, bj.ClientId, bj.CourierId })
                .ToListAsync();
            foreach (var l in links.Concat(direct).DistinctBy(x => (x.RunId, x.BulkJobId)))
            {
                if (l.JobId is { } j) result[l.RunId].JobIds.Add(j);
                else result[l.RunId].Unlinked.Add((l.ClientId, l.CourierId));
            }
        }

        var routes = runIds.Where(i => i < 0).Select(i => -i).Distinct().ToList();
        if (routes.Count > 0)
        {
            foreach (var r in await context.Routes.Where(r => routes.Contains(r.RouteId)).Select(r => new { r.RouteId, r.DefaultCourierId }).ToListAsync())
                result[-r.RouteId] = result[-r.RouteId] with { Courier = r.DefaultCourierId };

            foreach (var j in await context.TucJobs.Where(j => j.RouteId != null && routes.Contains(j.RouteId.Value) && !j.UcjbVoid)
                         .Select(j => new { RouteId = j.RouteId!.Value, j.UcjbId }).ToListAsync())
                result[-j.RouteId].JobIds.Add(j.UcjbId);
        }

        return result;
    }

    // Couriers: the runs' own couriers and the unlinked jobs' couriers, as the caller sees them. JobCouriers is the same set without the
    // parent-job placeholder courier: a run's courier counts whatever it is, but a job's courier does not make that job visible.
    private async Task<(HashSet<int> Couriers, HashSet<int> JobCouriers, HashSet<int> Jobs, HashSet<int> Clients)> RunLookupsAsync(
        DynamicDespatchDbContext context, BranchContext b, Dictionary<int, RunJobs> runs)
    {
        var couriers = await CouriersAsync(context, b, runs.Values.SelectMany(r => new[] { r.Courier }.Concat(r.Unlinked.Select(u => u.CourierId))).Where(c => c != null).Select(c => c!.Value));
        var jobCouriers = couriers.Where(c => c != b.ParentJobCourierId).ToHashSet();
        var jobs = await VisibleJobIdsCoreAsync(context, b, runs.Values.SelectMany(r => r.JobIds).ToList());
        var clients = await ClientsAsync(context, b, runs.Values.SelectMany(r => r.Unlinked.Select(u => u.ClientId)));
        return (couriers, jobCouriers, jobs, clients);
    }

    public async Task<IReadOnlySet<int>> VisibleRunIdsAsync(IReadOnlyCollection<int> runIds)
    {
        if (!IsRestricted) return runIds.ToHashSet();
        await using var context = await contextFactory.CreateDbContextAsync();
        var b = await BranchContextAsync(context);
        var runs = await RunJobsAsync(context, runIds);
        var (couriers, jobCouriers, jobs, clients) = await RunLookupsAsync(context, b, runs);

        return runs.Where(kv =>
                (kv.Value.Courier is { } c && couriers.Contains(c))
                || kv.Value.JobIds.Any(jobs.Contains)
                || kv.Value.Unlinked.Any(u => clients.Contains(u.ClientId) || (u.CourierId is { } uc && jobCouriers.Contains(uc))))
            .Select(kv => kv.Key).ToHashSet();
    }

    public async Task<bool> IsRunFullyVisibleAsync(int runId)
    {
        if (!IsRestricted) return true;
        await using var context = await contextFactory.CreateDbContextAsync();
        var b = await BranchContextAsync(context);
        var runs = await RunJobsAsync(context, [runId]);
        var (couriers, jobCouriers, jobs, clients) = await RunLookupsAsync(context, b, runs);
        var run = runs[runId];

        if (run.Courier is { } c && couriers.Contains(c)) return true;
        if (run.JobIds.Count == 0 && run.Unlinked.Count == 0) return false;
        return run.JobIds.All(jobs.Contains)
               && run.Unlinked.All(u => clients.Contains(u.ClientId) || (u.CourierId is { } uc && jobCouriers.Contains(uc)));
    }

    public async Task EnsureRunInScopeAsync(int runId)
    {
        if (!IsRestricted) return;
        if (!await IsRunFullyVisibleAsync(runId))
            throw new BranchScopeException($"Run {runId} is outside your branches.");
    }
}
