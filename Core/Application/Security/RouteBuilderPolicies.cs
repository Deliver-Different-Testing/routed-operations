using System.Security.Claims;

namespace RoutedOperations.Core.Application.Security;

/// <summary>
/// The claim rules behind the five RouteBuilder.* authorization policies.
///
/// Extracted from the inline lambdas in Program.cs on 2026-10-01 so the rules
/// can be unit-tested against a ClaimsPrincipal. Without the extraction a
/// policy test can only re-state the predicate it is meant to be checking,
/// which proves nothing.
///
/// TENANT STAFF ONLY (2026-10-09, Routed Ops switches spec section 6 step 1).
/// Route Builder, Quoting, Polygon and Bulk Import are tenant operations. Until
/// then every policy here admitted any caller with a CurrentTenantID who was
/// not a courier or partner, which included every customer contact of the
/// tenant: 73 dispatch and destructive actions sit behind RouteBuilder.Admin
/// alone. The only thing keeping customers out was the Hub tile grant.
///
/// What changed against the previous rules:
///   * Customers (and any caller whose ClientTypeId is not 4 or 5) are denied.
///   * The UserGroupID == "1" fast path on Admin is gone. It admitted without
///     checking tenant, courier or client type; staff are now decided by
///     ClientTypeId alone (CallerLane).
///   * Read and Quote/Polygon now deny couriers, matching Build and Admin.
///     Couriers have nothing in Routed Operations (spec section 4 table).
///   * Partners stay denied on all five, as Kevin made them (NP pay
///     visibility Part 4; Quote/Polygon on Steve's 2026-10-06 ruling).
///
/// The five names stay separate so Program.cs keeps one policy per concern.
/// Per-screen decisions come next from [RequireFeature("ro-...")], not from
/// splitting these further.
/// </summary>
public static class RouteBuilderPolicies
{
    /// <summary>Kept for existing callers; the rule lives in CallerLane.</summary>
    public static bool IsNetworkPartner(ClaimsPrincipal user) => CallerLane.IsNetworkPartner(user);

    /// <summary>RouteBuilder.Read.</summary>
    public static bool CanRead(ClaimsPrincipal user) => CallerLane.IsTenantStaff(user);

    /// <summary>RouteBuilder.Build. Authoring runs and jobs.</summary>
    public static bool CanBuild(ClaimsPrincipal user) => CallerLane.IsTenantStaff(user);

    /// <summary>RouteBuilder.Admin. Dispatch and destructive ops.</summary>
    public static bool CanAdmin(ClaimsPrincipal user) => CallerLane.IsTenantStaff(user);

    /// <summary>RouteBuilder.Quote and RouteBuilder.Polygon. Quote returns
    /// CostPerJob, TotalCost, MarginPct and RecommendedQuote; Polygon guards
    /// AutoAssignLogController and ZonesController.</summary>
    public static bool CanUsePlaceholderModule(ClaimsPrincipal user) => CallerLane.IsTenantStaff(user);
}
