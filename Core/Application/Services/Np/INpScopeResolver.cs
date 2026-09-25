// Resolves the caller's NP scope from the current HttpContext claims,
// with a per-request cache on HttpContext.Items so a controller + its
// service graph do not re-resolve on every SP call. Registered scoped in
// Program.cs.

namespace RoutedOperations.Core.Application.Services.Np;

public interface INpScopeResolver
{
    /// <summary>
    /// Returns the current NpScope. Cached per-request via
    /// HttpContext.Items["NpScope"].
    ///
    /// Resolution priority:
    ///   1. ClientTypeId claim == "5" -> IsAdmin=true (DF admin).
    ///   2. IsNetworkPartner claim != "True" -> IsAdmin=true (tenant staff).
    ///   3. Otherwise NP user - reads NpAgentId claim; if absent, does a
    ///      DB fallback: TucClients where UcclID == ClientID -> NpAgentId.
    ///   4. NpAgentId still null -> IsAdmin=false, NpAgentId=null
    ///      (callers MUST return empty; never widen to all rows).
    /// </summary>
    Task<NpScope> ResolveAsync();
}
