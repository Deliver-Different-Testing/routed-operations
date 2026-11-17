using RoutedOperations.Core.Application.Services.Np;

namespace RoutedOperations.Core.Application.Services.Branches;

// INpScopeGuard as registered in DI: the network partner check, then the branch check. Every existing
// "await scopeGuard.EnsureXInScopeAsync(id)" call site therefore enforces both rules without a second line at each site.
// Each rule does nothing for callers it does not apply to, so the order only decides which message wins.
public class NpAndBranchScopeGuard(NpScopeGuard npGuard, IBranchScopeGuard branchGuard) : INpScopeGuard
{
    public async Task EnsureTucJobInScopeAsync(int jobId)
    {
        await npGuard.EnsureTucJobInScopeAsync(jobId);
        await branchGuard.EnsureTucJobInScopeAsync(jobId);
    }

    public async Task EnsureBulkJobInScopeAsync(int bulkJobId)
    {
        await npGuard.EnsureBulkJobInScopeAsync(bulkJobId);
        await branchGuard.EnsureBulkJobInScopeAsync(bulkJobId);
    }

    public async Task EnsureTucJobByNumberInScopeAsync(string jobNumber)
    {
        await npGuard.EnsureTucJobByNumberInScopeAsync(jobNumber);
        await branchGuard.EnsureTucJobByNumberInScopeAsync(jobNumber);
    }

    public async Task EnsureRouteInScopeAsync(int routeId)
    {
        await npGuard.EnsureRouteInScopeAsync(routeId);
        await branchGuard.EnsureRouteInScopeAsync(routeId);
    }

    public async Task EnsureRunInScopeAsync(int runId)
    {
        await npGuard.EnsureRunInScopeAsync(runId);
        await branchGuard.EnsureRunInScopeAsync(runId);
    }

    // NP leak K6 (upstream). Network partner rule only: there is no branch rule for the mobile-keyed Client Intel
    // reads yet (known branch gap), so a branch-limited caller is not narrowed here.
    public Task EnsureMobileInScopeAsync(string mobile) => npGuard.EnsureMobileInScopeAsync(mobile);
}
