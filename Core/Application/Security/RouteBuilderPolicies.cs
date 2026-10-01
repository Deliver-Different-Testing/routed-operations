using System.Security.Claims;

namespace RoutedOperations.Core.Application.Security;

/// <summary>
/// The claim rules behind the five RouteBuilder.* authorization policies.
///
/// Extracted from the inline lambdas in Program.cs on 2026-10-01 so the rules
/// can be unit-tested against a ClaimsPrincipal. Behaviour is unchanged; this
/// is the same logic, moved. Without the extraction a policy test can only
/// re-state the predicate it is meant to be checking, which proves nothing.
///
/// Read, Build and Admin deny a logged-in network partner. Route Builder is
/// the tenant's planning tool: it reads and WRITES job Amount, run Revenue and
/// Payout and schedule pricing. This matches the 16-17 Sep configurator
/// decision that took Schedules and Recurring Routes out of the NP lane.
///
/// Quote and Polygon deliberately do NOT. Kevin's call 2026-10-01 (D1 = B):
/// stay inside the scope Steve's spec names, which is Read/Build/Admin only.
/// The consequence is recorded rather than quietly absorbed, and there is a
/// test pinning it so it reads as a decision and not an oversight:
///
///   * RouteBuilder.Quote guards QuoteController, which returns CostPerJob,
///     CostPerKm, TotalCost, MarginPct and RecommendedQuote. A partner can
///     still reach all of it. This is the most commercially sensitive surface
///     in the module.
///   * RouteBuilder.Polygon guards AutoAssignLogController (tenant dispatch
///     diagnostics) and ZonesController.
///
/// Raised with Steve in the Part 4 report.
///
/// Deliberately does NOT cover the RouteViewer.* policies. Route Viewer is the
/// partner's own lane; scoping there is row-level via INpScopeGuard and the
/// @NpAgentId SP parameter, not a policy denial.
///
/// Note on the claims: CurrentTenantID, IsCourier, UserGroupID and
/// IsNetworkPartner are all stamped by the Hub on the shared cookie. This
/// application cannot validate them, only read them.
///
/// See NP-PAY-PART4-TODO.md T1 / D1.
/// </summary>
public static class RouteBuilderPolicies
{
    /// <summary>Hub stamps the literal string "True" when the session belongs
    /// to a network partner. Anything else, including absent, is not one.</summary>
    public static bool IsNetworkPartner(ClaimsPrincipal user) =>
        string.Equals(user.FindFirst("IsNetworkPartner")?.Value, "True",
            StringComparison.OrdinalIgnoreCase);

    private static bool HasTenant(ClaimsPrincipal user) =>
        !string.IsNullOrEmpty(user.FindFirst("CurrentTenantID")?.Value);

    private static bool IsCourier(ClaimsPrincipal user) =>
        string.Equals(user.FindFirst("IsCourier")?.Value, "True",
            StringComparison.OrdinalIgnoreCase);

    /// <summary>RouteBuilder.Read. Any tenant user except a network partner.
    /// Note this has never excluded couriers, unlike Build and Admin.</summary>
    public static bool CanRead(ClaimsPrincipal user) =>
        HasTenant(user) && !IsNetworkPartner(user);

    /// <summary>RouteBuilder.Build. Authoring runs and jobs.</summary>
    public static bool CanBuild(ClaimsPrincipal user) =>
        HasTenant(user) && !IsCourier(user) && !IsNetworkPartner(user);

    /// <summary>
    /// RouteBuilder.Admin. Dispatch and destructive ops.
    ///
    /// ORDER MATTERS. The network-partner check sits ABOVE the UserGroupID
    /// fast path: that path admits without checking anything else, so a
    /// partner who also carried UserGroupID=1 would otherwise walk straight in.
    /// </summary>
    public static bool CanAdmin(ClaimsPrincipal user)
    {
        if (IsNetworkPartner(user)) return false;
        if (string.Equals(user.FindFirst("UserGroupID")?.Value, "1", StringComparison.Ordinal))
            return true;
        return HasTenant(user) && !IsCourier(user);
    }

    /// <summary>
    /// RouteBuilder.Quote and RouteBuilder.Polygon. Tenant claim only, with no
    /// network-partner check, so a partner passes BOTH.
    ///
    /// That is deliberate and scoped by D1 = B, not an omission. See the class
    /// comment for what stays reachable and why it is on Steve's desk. If the
    /// answer comes back that a partner must not see quoting margin, this
    /// becomes `HasTenant(user) &amp;&amp; !IsNetworkPartner(user)` and the
    /// Quote_And_Polygon_StillAdmitAPartner test flips with it.
    /// </summary>
    public static bool CanUsePlaceholderModule(ClaimsPrincipal user) =>
        HasTenant(user);
}
