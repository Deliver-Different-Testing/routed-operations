// The claim rules behind the five RouteBuilder.* policies.
//
// These are pure functions over a ClaimsPrincipal, which is the whole reason
// they were lifted out of the inline lambdas in Program.cs: a test of an inline
// lambda can only restate the lambda. Here the test exercises the real code the
// authorization pipeline calls.
//
// The case that matters most is CanAdmin ordering: the network-partner check
// must sit above the UserGroupID=1 fast path, because that path admits without
// looking at anything else.
//
// All five policies now deny a partner. Quote and Polygon were outside the
// original scope (D1 = B, Read/Build/Admin only) and admitted one on purpose
// until Steve's 2026-10-06 ruling; Quote_And_Polygon_DenyAPartner is the
// flipped version of the test that used to pin that gap.
//
// See NP-PAY-PART4-TODO.md T1 / T4 / D1.
using System.Security.Claims;
using RoutedOperations.Core.Application.Security;

namespace RoutedOperations.Tests.Security;

public class RouteBuilderPoliciesTests
{
    private static ClaimsPrincipal User(params (string Type, string Value)[] claims) =>
        new(new ClaimsIdentity(claims.Select(c => new Claim(c.Type, c.Value)), "test"));

    private static ClaimsPrincipal TenantStaff() => User(("CurrentTenantID", "42"));
    private static ClaimsPrincipal Partner() =>
        User(("CurrentTenantID", "42"), ("IsNetworkPartner", "True"), ("NpAgentId", "7"));
    private static ClaimsPrincipal Courier() =>
        User(("CurrentTenantID", "42"), ("IsCourier", "True"));

    // ── what the partner is and is not denied ─────────────────────────

    [Fact]
    public void Partner_IsDeniedOnReadBuildAndAdmin()
    {
        var np = Partner();
        Assert.False(RouteBuilderPolicies.CanRead(np));
        Assert.False(RouteBuilderPolicies.CanBuild(np));
        Assert.False(RouteBuilderPolicies.CanAdmin(np));
    }

    [Fact]
    public void Quote_And_Polygon_DenyAPartner()
    {
        // Flipped 2026-10-07 on Steve's 2026-10-06 ruling. Until then this
        // asserted the opposite, pinning a deliberate scope decision
        // (D1 = B, denial inside Read/Build/Admin only) so it read as a
        // decision and not an oversight.
        //
        // What the denial now closes:
        //   * QuoteController (RouteBuilder.Quote) - CostPerJob, CostPerKm,
        //     TotalCost, MarginPct, RecommendedQuote. The most commercially
        //     sensitive surface in the module.
        //   * AutoAssignLogController and ZonesController
        //     (RouteBuilder.Polygon) - tenant dispatch diagnostics.
        Assert.False(RouteBuilderPolicies.CanUsePlaceholderModule(Partner()));
    }

    [Fact]
    public void Quote_And_Polygon_StillAdmitTenantStaff()
    {
        // The other half of the ruling. Denying the partner must not deny
        // ordinary staff, including a courier: CanUsePlaceholderModule has
        // never excluded couriers, unlike Build and Admin.
        Assert.True(RouteBuilderPolicies.CanUsePlaceholderModule(TenantStaff()));
        Assert.True(RouteBuilderPolicies.CanUsePlaceholderModule(Courier()));
    }

    [Fact]
    public void Partner_WithUserGroupId1_IsStillDeniedOnAdmin()
    {
        // The regression this ordering exists for. UserGroupID=1 returns true
        // without checking tenant or courier, so if the NP check sat below it
        // a partner carrying that claim would be admitted to every destructive
        // endpoint in the module.
        var np = User(
            ("CurrentTenantID", "42"),
            ("IsNetworkPartner", "True"),
            ("UserGroupID", "1"));
        Assert.False(RouteBuilderPolicies.CanAdmin(np));
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

    [Fact]
    public void IsNetworkPartner_IsFalseWhenTheClaimIsAbsent()
    {
        Assert.False(RouteBuilderPolicies.IsNetworkPartner(TenantStaff()));
    }

    // ── nothing else changed ──────────────────────────────────────────

    [Fact]
    public void TenantStaff_KeepsEveryPolicy()
    {
        var staff = TenantStaff();
        Assert.True(RouteBuilderPolicies.CanRead(staff));
        Assert.True(RouteBuilderPolicies.CanBuild(staff));
        Assert.True(RouteBuilderPolicies.CanAdmin(staff));
        Assert.True(RouteBuilderPolicies.CanUsePlaceholderModule(staff));
    }

    [Fact]
    public void Anonymous_IsStillDeniedOnQuoteAndPolygon()
    {
        // The tenant check is the only thing those two have left, so prove it
        // is still doing work after the NP clause came out.
        Assert.False(RouteBuilderPolicies.CanUsePlaceholderModule(User()));
    }

    [Fact]
    public void Courier_KeepsRead_ButNotBuildOrAdmin()
    {
        // Pre-existing asymmetry, preserved deliberately: Read never had a
        // courier check. Documented here so a future reader does not assume
        // it is an oversight introduced by the NP work.
        var courier = Courier();
        Assert.True(RouteBuilderPolicies.CanRead(courier));
        Assert.False(RouteBuilderPolicies.CanBuild(courier));
        Assert.False(RouteBuilderPolicies.CanAdmin(courier));
    }

    [Fact]
    public void UserGroupId1_StillBypassesTenantAndCourierOnAdmin()
    {
        var superuser = User(("UserGroupID", "1"), ("IsCourier", "True"));
        Assert.True(RouteBuilderPolicies.CanAdmin(superuser));
    }

    [Fact]
    public void NoTenantClaim_IsDeniedEverywhere()
    {
        var anon = User();
        Assert.False(RouteBuilderPolicies.CanRead(anon));
        Assert.False(RouteBuilderPolicies.CanBuild(anon));
        Assert.False(RouteBuilderPolicies.CanAdmin(anon));
        Assert.False(RouteBuilderPolicies.CanUsePlaceholderModule(anon));
    }
}
