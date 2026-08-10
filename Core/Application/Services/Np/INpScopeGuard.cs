// Row-level authorization guard for cross-scope access denial. Every
// Route Viewer endpoint that accepts a job id / bulk job id / route id /
// run id in its query or body MUST call the corresponding EnsureXInScope
// method before returning or writing anything. Throws NpLabelScopeException
// which controllers map to HTTP 403 Forbidden.
//
// Admin (IsAdmin=true) scope short-circuits every check to a no-op.
// NP (IsAdmin=false + NpAgentId set) checks the tenant DB row's own
// NpAgentId column against the scope's NpAgentId.
// Degenerate (IsAdmin=false + NpAgentId null) always throws - no NP
// user can access ANY row when their agent linkage is unresolved.

namespace RoutedOperations.Core.Application.Services.Np;

public interface INpScopeGuard
{
    /// <summary>
    /// Throws NpLabelScopeException if the tucJob row does not belong to
    /// the current NP scope. No-op for admin scope.
    /// </summary>
    Task EnsureTucJobInScopeAsync(int jobId);

    /// <summary>
    /// Throws NpLabelScopeException if the tblBulkJob row does not
    /// belong to the current NP scope. No-op for admin scope.
    /// </summary>
    Task EnsureBulkJobInScopeAsync(int bulkJobId);

    /// <summary>
    /// Throws NpLabelScopeException if no tucJob row with the given
    /// job number belongs to the current NP scope. Used for the
    /// job-number search path where the caller does not know the id.
    /// No-op for admin scope.
    /// </summary>
    Task EnsureTucJobByNumberInScopeAsync(string jobNumber);

    /// <summary>
    /// Throws NpLabelScopeException if any non-void tucJob row on the
    /// route belongs to a different NP scope (mixed-tenant routes are
    /// rejected entirely). No-op for admin scope.
    /// </summary>
    Task EnsureRouteInScopeAsync(int routeId);

    /// <summary>
    /// Throws NpLabelScopeException if any tblBulkJob row in the run
    /// belongs to a different NP scope. Synthetic negative runIds
    /// delegate to EnsureRouteInScopeAsync(-runId). No-op for admin scope.
    /// </summary>
    Task EnsureRunInScopeAsync(int runId);
}
