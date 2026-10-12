// The claim rules behind the RouteBuilder.* and RouteViewer.* policies, and
// the CallerLane signals they sit on.
//
// These are pure functions over a ClaimsPrincipal, which is the whole reason
// they were lifted out of the inline lambdas in Program.cs: a test of an inline
// lambda can only restate the lambda. Here the test exercises the real code the
// authorization pipeline calls.
//
// 2026-10-09 (Routed Ops switches spec section 6 step 1): staff is ClientTypeId
// 4 or 5 and nothing else. Customers are denied on every policy, the Internal
// claim and UserGroupID=1 admit nobody, and couriers are denied everywhere.
// Partners stay denied on Route Builder (NP pay visibility Part 4) and keep
// Route Viewer, their own lane.
using System.Security.Claims;
using RoutedOperations.Core.Application.Security;

namespace RoutedOperations.Tests.Security;

public class RouteBuilderPoliciesTests
{
    private static ClaimsPrincipal User(params (string Type, string Value)[] claims) =>
        new(new ClaimsIdentity(claims.Select(c => new Claim(c.Type, c.Value)), "test"));

    private static ClaimsPrincipal TenantStaff() =>
        User(("CurrentTenantID", "42"), ("ClientTypeId", "4"));
    private static ClaimsPrincipal DfAdmin() =>
        User(("CurrentTenantID", "42"), ("ClientTypeId", "5"));
    private static ClaimsPrincipal Customer() =>
        User(("CurrentTenantID", "42"), ("ClientTypeId", "2"), ("ContactID", "9"), ("ClientID", "123"));
    private static ClaimsPrincipal Partner() =>
        User(("CurrentTenantID", "42"), ("ClientTypeId", "3"), ("IsNetworkPartner", "True"), ("NpAgentId", "7"));
    private static ClaimsPrincipal Courier() =>
        User(("CurrentTenantID", "42"), ("IsCourier", "True"));

    private static void AssertNoRouteBuilder(ClaimsPrincipal user)
    {
        Assert.False(RouteBuilderPolicies.CanRead(user));
        Assert.False(RouteBuilderPolicies.CanBuild(user));
        Assert.False(RouteBuilderPolicies.CanAdmin(user));
        Assert.False(RouteBuilderPolicies.CanUsePlaceholderModule(user));
    }

    private static void AssertNoRouteViewer(ClaimsPrincipal user)
    {
        Assert.False(RouteViewerPolicies.CanRead(user));
        Assert.False(RouteViewerPolicies.CanAdmin(user));
        Assert.False(RouteViewerPolicies.CanUseNpScope(user));
    }

    // ── staff keep everything ─────────────────────────────────────────

    [Fact]
    public void TenantStaff_And_DfAdmin_KeepEveryPolicy()
    {
        foreach (var staff in new[] { TenantStaff(), DfAdmin() })
        {
            Assert.True(RouteBuilderPolicies.CanRead(staff));
            Assert.True(RouteBuilderPolicies.CanBuild(staff));
            Assert.True(RouteBuilderPolicies.CanAdmin(staff));
            Assert.True(RouteBuilderPolicies.CanUsePlaceholderModule(staff));
            Assert.True(RouteViewerPolicies.CanRead(staff));
            Assert.True(RouteViewerPolicies.CanAdmin(staff));
            Assert.True(RouteViewerPolicies.CanUseNpScope(staff));
        }
    }

    // ── the hole this closes ──────────────────────────────────────────

    [Fact]
    public void Customer_IsDeniedEverywhere()
    {
        // Before: a customer contact passed RouteBuilder.Admin (73 dispatch and
        // destructive actions) and every RouteViewer policy. The only thing
        // keeping them out was the Hub tile grant.
        AssertNoRouteBuilder(Customer());
        AssertNoRouteViewer(Customer());
    }

    [Theory]
    [InlineData("2")]
    [InlineData("1")]
    public void InternalClaim_DoesNotMakeAnyoneStaff(string clientTypeId)
    {
        // ucclInternal is a billing flag; ClientType 1 carries no grants
        // (Steve 2026-10-08).
        var internalCustomer = User(
            ("CurrentTenantID", "42"), ("ClientTypeId", clientTypeId), ("Internal", "True"));
        Assert.False(CallerLane.IsStaff(internalCustomer));
        AssertNoRouteBuilder(internalCustomer);
        AssertNoRouteViewer(internalCustomer);
    }

    [Fact]
    public void UserGroupId1_NoLongerAdmitsANonStaffCaller()
    {
        // The old Admin fast path returned true on UserGroupID=1 without
        // looking at tenant, courier or client type.
        var legacyAdminCustomer = User(
            ("CurrentTenantID", "42"), ("ClientTypeId", "2"), ("UserGroupID", "1"));
        Assert.False(RouteBuilderPolicies.CanAdmin(legacyAdminCustomer));
        Assert.False(RouteViewerPolicies.CanAdmin(legacyAdminCustomer));

        var noTenant = User(("UserGroupID", "1"), ("ClientTypeId", "5"));
        Assert.False(RouteBuilderPolicies.CanAdmin(noTenant));
    }

    [Fact]
    public void MissingClientTypeId_IsNotStaff()
    {
        // Fail closed: a tenant session with no client type is nobody.
        var unknown = User(("CurrentTenantID", "42"));
        AssertNoRouteBuilder(unknown);
        AssertNoRouteViewer(unknown);
    }

    // ── partners ──────────────────────────────────────────────────────

    [Fact]
    public void Partner_IsDeniedRouteBuilder_ButKeepsRouteViewer()
    {
        AssertNoRouteBuilder(Partner());
        Assert.True(RouteViewerPolicies.CanRead(Partner()));
        Assert.True(RouteViewerPolicies.CanAdmin(Partner()));
        Assert.True(RouteViewerPolicies.CanUseNpScope(Partner()));
    }

    [Fact]
    public void Partner_WithAStaffClientType_IsStillDeniedRouteBuilder()
    {
        // The partner flag wins over the client type, as the NP check used to
        // win over the UserGroupID fast path.
        var np = User(("CurrentTenantID", "42"), ("ClientTypeId", "4"), ("IsNetworkPartner", "True"));
        AssertNoRouteBuilder(np);
    }

    [Theory]
    [InlineData("true")]
    [InlineData("TRUE")]
    [InlineData("True")]
    public void IsNetworkPartner_IsCaseInsensitive(string value)
    {
        Assert.True(RouteBuilderPolicies.IsNetworkPartner(
            User(("CurrentTenantID", "42"), ("IsNetworkPartner", value))));
    }

    [Theory]
    [InlineData("False")]
    [InlineData("")]
    [InlineData("1")]
    public void IsNetworkPartner_IsFalseForAnythingButTrue(string value)
    {
        Assert.False(RouteBuilderPolicies.IsNetworkPartner(
            User(("CurrentTenantID", "42"), ("IsNetworkPartner", value))));
    }

    // ── couriers and anonymous ────────────────────────────────────────

    [Fact]
    public void Courier_IsDeniedEverywhere()
    {
        // Couriers have nothing in Routed Operations (spec section 4). Read
        // and Quote/Polygon used to admit them.
        AssertNoRouteBuilder(Courier());
        AssertNoRouteViewer(Courier());

        var staffTypedCourier = User(("CurrentTenantID", "42"), ("ClientTypeId", "4"), ("IsCourier", "True"));
        AssertNoRouteBuilder(staffTypedCourier);
        AssertNoRouteViewer(staffTypedCourier);
    }

    [Fact]
    public void NoTenantClaim_IsDeniedEverywhere()
    {
        var staffNoTenant = User(("ClientTypeId", "4"));
        AssertNoRouteBuilder(staffNoTenant);
        AssertNoRouteViewer(staffNoTenant);
        AssertNoRouteBuilder(User());
        AssertNoRouteViewer(User());
    }
}
