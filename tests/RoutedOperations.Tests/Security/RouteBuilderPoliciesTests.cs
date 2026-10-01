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
// Scope is Read/Build/Admin only (D1 = B). Quote and Polygon still admit a
// partner on purpose; Quote_And_Polygon_StillAdmitAPartner pins that so it is
// a visible decision rather than something found later.
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
    public void Quote_And_Polygon_StillAdmitAPartner()
    {
        // NOT an oversight. Kevin's call 2026-10-01 (D1 = B): the denial stays
        // inside the scope Steve's spec names, which is Read/Build/Admin.
        //
        // What that leaves reachable, raised with Steve in the Part 4 report:
        //   * QuoteController (RouteBuilder.Quote) - CostPerJob, CostPerKm,
        //     TotalCost, MarginPct, RecommendedQuote. The most commercially
        //     sensitive surface in the module.
        //   * AutoAssignLogController and ZonesController (RouteBuilder.Polygon)
        //     - tenant dispatch diagnostics.
        //
        // This test exists so the state is visible in the suite rather than
        // discovered later. If Steve says a partner must not see quoting
        // margin, flip CanUsePlaceholderModule and flip this with it.
        Assert.True(RouteBuilderPolicies.CanUsePlaceholderModule(Partner()));
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
