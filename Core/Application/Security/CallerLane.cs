using System.Security.Claims;

namespace RoutedOperations.Core.Application.Security;

/// <summary>
/// Which lane a signed-in caller is in, read from the Hub-stamped claims.
///
/// STAFF IS CLIENT TYPE 4 (Tenant) OR 5 (DF Admin), NOTHING ELSE. Steve's
/// ruling 2026-10-08 (STEVE-CUSTOMER-BOOKING-ACCESS-AND-ACCOUNT-STATUS
/// section F): ucclInternal and ClientType 1 (Internal) carry no permissions
/// anywhere. The Hub "Internal" claim is the ucclInternal billing flag, which
/// the 2026-08-31 audit found on cost centres, driver accounts and real
/// customers, so it is never read as a staff signal here.
///
/// UserGroupID is not read either. It is the legacy DF Admin signal being
/// retired (Access Control G6), and Hub can stamp it on a customer whose
/// record was created by an admin.
///
/// Note on the claims: CurrentTenantID, ClientTypeId, IsCourier and
/// IsNetworkPartner are all stamped by the Hub on the shared cookie. This
/// application cannot validate them, only read them.
///
/// See GARRY-ROUTED-OPS-MENU-SWITCHES-2026-09-30.md section 4 / section 6 step 1.
/// </summary>
public static class CallerLane
{
    private const string TenantClientType = "4";
    private const string DfAdminClientType = "5";

    public static bool HasTenant(ClaimsPrincipal user) =>
        !string.IsNullOrEmpty(user.FindFirst("CurrentTenantID")?.Value);

    /// <summary>Tenant staff or DF Admin, by ClientTypeId only.</summary>
    public static bool IsStaff(ClaimsPrincipal user) =>
        user.FindFirst("ClientTypeId")?.Value?.Trim() is TenantClientType or DfAdminClientType;

    /// <summary>DF Admin (ClientTypeId 5).</summary>
    public static bool IsDfAdmin(ClaimsPrincipal user) =>
        user.FindFirst("ClientTypeId")?.Value?.Trim() == DfAdminClientType;

    /// <summary>Hub stamps the literal string "True" when the session belongs
    /// to a network partner. Anything else, including absent, is not one.</summary>
    public static bool IsNetworkPartner(ClaimsPrincipal user) =>
        string.Equals(user.FindFirst("IsNetworkPartner")?.Value, "True",
            StringComparison.OrdinalIgnoreCase);

    public static bool IsCourier(ClaimsPrincipal user) =>
        string.Equals(user.FindFirst("IsCourier")?.Value, "True",
            StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Tenant staff signed in to a tenant: the only callers who may reach
    /// tenant-wide data and tenant operations. A network partner or courier
    /// is never staff here, even if their client type says otherwise.
    /// </summary>
    public static bool IsTenantStaff(ClaimsPrincipal user) =>
        HasTenant(user) && IsStaff(user) && !IsNetworkPartner(user) && !IsCourier(user);
}
