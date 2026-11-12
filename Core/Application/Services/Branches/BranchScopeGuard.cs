// Implementation of IBranchScopeGuard. Mirrors NpScopeGuard: tucJob is the
// source of truth for a job's client and courier; bulk jobs reach through
// tblBulkJob.JobId to tucJob (falling back to tblBulkJob's own ClientID /
// CourierID when the bulk job has no live job yet); negative run ids are
// synthetic Route Runs and delegate to the route check.
//
// The rule itself (client / courier / job visible) lives in BranchPredicates
// and BranchRowFilter.IsJobVisible. This class only fetches rows.
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Branches;

public class BranchScopeGuard(
    IBranchScopeResolver scopeResolver,
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IOptions<BranchVisibilityOptions> options) : IBranchScopeGuard
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

    public async Task EnsureTucJobInScopeAsync(int jobId)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);

        var row = await context.TucJobs
            .Where(j => j.UcjbId == jobId)
            .Select(j => new JobBranchRow { ClientId = j.UcjbClientId, CourierId = j.UcjbCourierId })
            .FirstOrDefaultAsync();

        if (row is null || !filter.IsJobVisible(row.ClientId, row.CourierId))
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

        // tucJob is the source of truth once the bulk job is live (NP parity);
        // before that the bulk job's own client / courier are all there is.
        JobBranchRow? row = null;
        if (bulk.JobId.HasValue)
        {
            row = await context.TucJobs
                .Where(j => j.UcjbId == bulk.JobId.Value)
                .Select(j => new JobBranchRow { ClientId = j.UcjbClientId, CourierId = j.UcjbCourierId })
                .FirstOrDefaultAsync();
        }
        row ??= new JobBranchRow { ClientId = bulk.ClientId, CourierId = bulk.CourierId };

        if (!filter.IsJobVisible(row.ClientId, row.CourierId))
            throw new BranchScopeException($"tblBulkJob {bulkJobId} is outside your branches.");
    }

    public async Task EnsureTucJobByNumberInScopeAsync(string jobNumber)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);

        // Every tucJob row with the number must be visible (NP parity).
        var rows = await context.TucJobs
            .Where(j => j.UcjbNumber == jobNumber)
            .Select(j => new JobBranchRow { ClientId = j.UcjbClientId, CourierId = j.UcjbCourierId })
            .ToListAsync();

        if (rows.Any(r => !filter.IsJobVisible(r.ClientId, r.CourierId)))
            throw new BranchScopeException($"Job number '{jobNumber}' is outside your branches.");
    }

    public async Task EnsureRouteInScopeAsync(int routeId)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);

        // Every non-void job on the route must be visible (NP parity: mixed
        // routes are rejected entirely).
        var rows = await context.TucJobs
            .Where(j => j.RouteId == routeId && !j.UcjbVoid)
            .Select(j => new JobBranchRow { ClientId = j.UcjbClientId, CourierId = j.UcjbCourierId })
            .ToListAsync();

        if (rows.Any(r => !filter.IsJobVisible(r.ClientId, r.CourierId)))
            throw new BranchScopeException($"Route {routeId} has jobs outside your branches.");
    }

    public async Task EnsureRunInScopeAsync(int runId)
    {
        var scope = scopeResolver.Resolve();
        if (!scope.IsRestricted) return;

        // Synthetic Route Run ids come through negative (NP parity).
        if (runId < 0)
        {
            await EnsureRouteInScopeAsync(-runId);
            return;
        }

        await using var context = await contextFactory.CreateDbContextAsync();
        var filter = await LoadFilterAsync(context, scope);

        var rows = await (
            from r in context.TblBulkJobRuns.Where(r => r.RunId == runId)
            join b in context.TblBulkJobs on r.BulkJobId equals b.BulkJobId
            join j in context.TucJobs on b.JobId equals j.UcjbId
            select new JobBranchRow { ClientId = j.UcjbClientId, CourierId = j.UcjbCourierId }
        ).ToListAsync();

        if (rows.Any(r => !filter.IsJobVisible(r.ClientId, r.CourierId)))
            throw new BranchScopeException($"Run {runId} has jobs outside your branches.");
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

        _filter = BranchRowFilter.Restricted(clientIds, courierIds, options.Value.JobVisibleViaCourierBranch);
        return _filter;
    }

    private sealed class JobBranchRow
    {
        public int? ClientId { get; init; }
        public int? CourierId { get; init; }
    }
}
