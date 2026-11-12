// INpScopeGuard as registered in DI: the NP check, then the branch check.
// Every existing "await scopeGuard.EnsureXInScopeAsync(id)" call site therefore
// enforces both rules (Branches B2: "IBranchScopeGuard called wherever the NP
// guard is") without a second line at each site. Each rule no-ops for callers
// it does not apply to, so the order only decides which 403 message wins.
using RoutedOperations.Core.Application.Services.Np;

namespace RoutedOperations.Core.Application.Services.Branches;

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
}
