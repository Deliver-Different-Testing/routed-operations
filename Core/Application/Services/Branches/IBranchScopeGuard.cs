// Row-level branch guard for tenant staff (Branches programme B2), modelled on
// INpScopeGuard with the same method set and semantics:
//
// - Unrestricted scope (no BranchIds claim, non-staff, NP, system work)
//   short-circuits every check to a no-op with no DB access.
// - Restricted scope throws BranchScopeException (an NpLabelScopeException, so
//   controllers already map it to HTTP 403) when the row is outside the
//   caller's branches. A missing row throws, as the NP guard does.
// - Route / run: in scope only if EVERY job on it is visible (mixed routes are
//   rejected entirely, mirroring NpScopeGuard).
//
// Every INpScopeGuard call also runs this guard: INpScopeGuard is registered
// as NpAndBranchScopeGuard (Program.cs), so the existing call sites need no
// second line. List endpoints use GetRowFilterAsync to post-filter results.

namespace RoutedOperations.Core.Application.Services.Branches;

public interface IBranchScopeGuard
{
    Task EnsureTucJobInScopeAsync(int jobId);

    Task EnsureBulkJobInScopeAsync(int bulkJobId);

    Task EnsureTucJobByNumberInScopeAsync(string jobNumber);

    Task EnsureRouteInScopeAsync(int routeId);

    Task EnsureRunInScopeAsync(int runId);

    /// <summary>The caller's visible client / courier sets for list
    /// post-filtering. BranchRowFilter.Unrestricted for unrestricted callers
    /// (no DB access). Cached for the request.</summary>
    Task<BranchRowFilter> GetRowFilterAsync();
}
