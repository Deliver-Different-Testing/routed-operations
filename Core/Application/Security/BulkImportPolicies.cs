using System.Security.Claims;
using DeliverDifferent.AccessControl;

namespace RoutedOperations.Core.Application.Security;

/// <summary>
/// The claim rule behind the BulkImport.Use authorization policy
/// (ro-bulk-import-customer-scope, 2026-11).
///
/// INTERIM, PENDING GARRY'S AGREEMENT. Garry owns the Routed Operations access
/// policies (switches spec section 4: one screen-access policy, no per-lane
/// lists). Until that single policy exists, this one admits the two lanes that
/// Bulk Import is for: tenant staff and customers. Everything else about who
/// may do what is decided further in:
///   * [RequireFeature("ro-bulk-import")] decides whether the screen is
///     switched on for the caller's client type (Access Control).
///   * IBulkClientScope cuts every read and write to the caller's own clients.
///   * Staff-only actions keep [Authorize(Policy = "RouteBuilder.Admin")] at
///     action level. ASP.NET ANDs stacked [Authorize] attributes, so those
///     stay staff-only under this looser controller policy.
///
/// RouteBuilder.Admin itself is NOT relaxed; customers still fail every
/// RouteBuilder.* and RouteViewer.* policy.
///
/// Admitted: signed in to a tenant, not a courier, not a network partner, and
/// either staff (ClientTypeId 4/5) or a customer (ClientTypeId 2). A missing or
/// unknown client type is refused (fail closed). The Internal claim and
/// UserGroupID play no part.
/// </summary>
public static class BulkImportPolicies
{
    public const string Use = "BulkImport.Use";

    public static bool CanUse(ClaimsPrincipal user) =>
        CallerLane.HasTenant(user)
        && !CallerLane.IsCourier(user)
        && !CallerLane.IsNetworkPartner(user)
        && (CallerLane.IsStaff(user) || CallerLane.ClientTypeId(user) == CallerLane.CustomerClientType);
}
