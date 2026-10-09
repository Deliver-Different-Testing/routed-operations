using System.Security.Claims;

namespace RoutedOperations.Core.Application.Security;

/// <summary>
/// The claim rules behind the three RouteViewer.* authorization policies.
///
/// Route Viewer is the network partner's own lane, so unlike Route Builder it
/// admits partners; their rows are cut down by INpScopeGuard and the
/// @NpAgentId SP parameter, not by policy.
///
/// It does NOT admit customers yet (2026-10-09, Routed Ops switches spec
/// section 6 step 1). Before this every policy admitted any caller with a
/// CurrentTenantID, Admin admitted anyone who was not a courier, and
/// NpScopeResolver gave every non-partner the unfiltered tenant scope. So a
/// customer contact could read every client's runs and call the dispatch
/// endpoints. The customer view (spec section 5a) opens this again once its
/// scope is resolved from claims and checked against the legacy app.
///
/// Couriers are denied on all three (they never had Read denied before), and
/// the UserGroupID == "1" fast path on Admin is gone; see CallerLane.
/// </summary>
public static class RouteViewerPolicies
{
    /// <summary>Tenant staff, or a network partner, signed in to a tenant.</summary>
    private static bool IsStaffOrPartner(ClaimsPrincipal user) =>
        CallerLane.HasTenant(user)
        && !CallerLane.IsCourier(user)
        && (CallerLane.IsStaff(user) || CallerLane.IsNetworkPartner(user));

    /// <summary>RouteViewer.Read.</summary>
    public static bool CanRead(ClaimsPrincipal user) => IsStaffOrPartner(user);

    /// <summary>RouteViewer.Admin. Partners still pass: the Admin endpoints
    /// they use (assignment, labels) run INpScopeGuard on every row.</summary>
    public static bool CanAdmin(ClaimsPrincipal user) => IsStaffOrPartner(user);

    /// <summary>RouteViewer.NpScope. A marker that the controller runs under
    /// NP-aware guard rails; same admit rule as Read.</summary>
    public static bool CanUseNpScope(ClaimsPrincipal user) => IsStaffOrPartner(user);
}
