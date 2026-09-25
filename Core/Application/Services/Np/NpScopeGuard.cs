// Implementation of INpScopeGuard. Uses INpScopeResolver to determine
// the caller's scope, then queries the target row via EF Core to compare
// the row's NpAgentId column against the scope's NpAgentId. Throws
// NpLabelScopeException on mismatch, no-op on admin scope.
//
// Source of truth is tucJob.NpAgentId. tblBulkJob has its own NpAgentId
// column but it is only populated by the prebook Monitor path
// (UTL_stpJobBooking_InsertJob / UTL_stpJobBooking_InsertSchedule); ad-hoc
// NP assignments from RunViewer's 3-way Assign Route picker stamp only
// tucJob.NpAgentId, so a guard reading tblBulkJob.NpAgentId would
// silently reject those jobs even for the correct NP. The bulk-job +
// positive-run paths reach through TblBulkJob.JobId to tucJob.ucjbID and
// pick up NpAgentId from tucJob for that reason (matches the SP-side
// fix in dbmigrationsv2 20260818120000_RVW_stpBulkRuns_2_NpAgentFromTucJob).
//
// Route guarding is per-tucJob: a route is "in scope" for an NP when
// every non-void tucJob assigned to that route belongs to the NP.
// Mixed-tenant routes are rejected entirely (safest default).
//
// Run guarding: negative runId is a synthetic Route Run id (delegates
// to EnsureRouteInScopeAsync(-runId)); positive runId is a real
// tblBulkRun (checks every job on the run via the tblBulkJobRun
// junction, joining through to tucJob for NpAgentId).
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Np;

public class NpScopeGuard(
    INpScopeResolver scopeResolver,
    IDbContextFactory<DynamicDespatchDbContext> contextFactory) : INpScopeGuard
{
    public async Task EnsureTucJobInScopeAsync(int jobId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (scope.IsAdmin) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        var rowNpAgentId = await context.TucJobs
            .Where(j => j.UcjbId == jobId)
            .Select(j => j.NpAgentId)
            .FirstOrDefaultAsync();

        if (rowNpAgentId != scope.NpAgentId)
            throw new NpLabelScopeException($"tucJob {jobId} is outside your NP scope.");
    }

    public async Task EnsureBulkJobInScopeAsync(int bulkJobId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (scope.IsAdmin) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        // Reach through TblBulkJob.JobId to tucJob.ucjbID for NpAgentId.
        // See header comment on why tblBulkJob.NpAgentId is not authoritative.
        var rowNpAgentId = await context.TblBulkJobs
            .Where(b => b.BulkJobId == bulkJobId)
            .Select(b => context.TucJobs
                .Where(j => j.UcjbId == b.JobId)
                .Select(j => (int?)j.NpAgentId)
                .FirstOrDefault())
            .FirstOrDefaultAsync();

        if (rowNpAgentId != scope.NpAgentId)
            throw new NpLabelScopeException($"tblBulkJob {bulkJobId} is outside your NP scope.");
    }

    public async Task EnsureTucJobByNumberInScopeAsync(string jobNumber)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (scope.IsAdmin) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        // Any tucJob row with the number must match the scope. If any
        // matching row carries a different NpAgentId, block.
        var mismatched = await context.TucJobs
            .Where(j => j.UcjbNumber == jobNumber)
            .AnyAsync(j => j.NpAgentId != scope.NpAgentId);

        if (mismatched)
            throw new NpLabelScopeException($"Job number '{jobNumber}' is outside your NP scope.");
    }

    public async Task EnsureRouteInScopeAsync(int routeId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (scope.IsAdmin) return;

        await using var context = await contextFactory.CreateDbContextAsync();
        // Route is in scope only if EVERY non-void tucJob on the route
        // carries the same NpAgentId as the scope. Mixed-tenant routes
        // are rejected entirely (safer than partial-visibility).
        var mixed = await context.TucJobs
            .Where(j => j.RouteId == routeId && !j.UcjbVoid)
            .AnyAsync(j => j.NpAgentId != scope.NpAgentId);

        if (mixed)
            throw new NpLabelScopeException($"Route {routeId} has jobs outside your NP scope.");
    }

    public async Task EnsureRunInScopeAsync(int runId)
    {
        var scope = await scopeResolver.ResolveAsync();
        if (scope.IsAdmin) return;

        // Synthetic Route Run ids come through negative; delegate to
        // EnsureRouteInScopeAsync(-runId) per master Section 1.
        if (runId < 0)
        {
            await EnsureRouteInScopeAsync(-runId);
            return;
        }

        // Positive run id -> real tblBulkRun. Any tucJob reached through
        // the tblBulkJobRun -> tblBulkJob -> tucJob chain with a different
        // NpAgentId blocks. tucJob is the source of truth (see header).
        await using var context = await contextFactory.CreateDbContextAsync();
        var mixed = await (
            from r in context.TblBulkJobRuns.Where(r => r.RunId == runId)
            join b in context.TblBulkJobs on r.BulkJobId equals b.BulkJobId
            join j in context.TucJobs on b.JobId equals j.UcjbId
            select (int?)j.NpAgentId
        ).AnyAsync(np => np != scope.NpAgentId);

        if (mixed)
            throw new NpLabelScopeException($"Run {runId} has jobs outside your NP scope.");
    }
}
