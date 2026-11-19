using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Services.Branches;

namespace RoutedOperations.Tests.Branches;

// The BranchIds claim: only tenant staff are ever branch limited; empty = unrestricted; a bad token fails closed.
public class BranchScopeResolverTests
{
    private static IHttpContextAccessor AccessorWith(params Claim[] claims)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims)) });
        return accessor;
    }

    private static Claim[] Staff(string? branchIds, string clientType = "4") =>
        branchIds is null
            ? [new("ClientTypeId", clientType), new("IsNetworkPartner", "False")]
            : [new("ClientTypeId", clientType), new("IsNetworkPartner", "False"), new("BranchIds", branchIds)];

    // ---- Parse ----

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Parse_EmptyOrAbsent_IsUnrestricted(string? raw)
    {
        Assert.False(BranchScopeResolver.Parse(raw).IsRestricted);
    }

    [Theory]
    [InlineData("1", new[] { 1 })]
    [InlineData("1,2", new[] { 1, 2 })]
    [InlineData(" 2 , 1 ", new[] { 2, 1 })]
    [InlineData("3,3", new[] { 3 })]
    [InlineData("1,,2,", new[] { 1, 2 })]
    public void Parse_ACommaList_IsRestrictedToThoseBranches(string raw, int[] expected)
    {
        var scope = BranchScopeResolver.Parse(raw);

        Assert.True(scope.IsRestricted);
        Assert.Equal(expected, scope.BranchIds);
    }

    [Theory]
    [InlineData("x")]
    [InlineData("1,x")]
    [InlineData("0")]
    [InlineData("-3")]
    [InlineData(",")]
    [InlineData(" , ")]
    public void Parse_ABadClaim_IsRestrictedToNothing_FailingClosed(string raw)
    {
        var scope = BranchScopeResolver.Parse(raw);

        Assert.True(scope.IsRestricted);
        Assert.Empty(scope.BranchIds);
    }

    // ---- who is limited ----

    [Fact]
    public void TenantStaffWithBranches_AreRestricted()
    {
        var scope = new BranchScopeResolver(AccessorWith(Staff("2,1"))).Resolve();

        Assert.True(scope.IsRestricted);
        Assert.Equal([2, 1], scope.BranchIds);
    }

    [Fact]
    public void TenantStaffWithNoClaim_AreUnrestricted()
    {
        Assert.False(new BranchScopeResolver(AccessorWith(Staff(null))).Resolve().IsRestricted);
    }

    [Fact]
    public void DfAdmin_IsNeverRestricted_EvenWithTheClaim()
    {
        Assert.False(new BranchScopeResolver(AccessorWith(Staff("1", clientType: "5"))).Resolve().IsRestricted);
    }

    [Fact]
    public void NetworkPartner_IsNeverRestricted_ByTheBranchRule()
    {
        var claims = new Claim[] { new("ClientTypeId", "3"), new("IsNetworkPartner", "True"), new("NpAgentId", "7"), new("BranchIds", "1") };

        Assert.False(new BranchScopeResolver(AccessorWith(claims)).Resolve().IsRestricted);
    }

    [Theory]
    [InlineData("2")]    // customer
    [InlineData(null)]   // no claims at all
    public void CustomersAndAnonymousCallers_AreNotBranchScoped(string? clientType)
    {
        var claims = clientType is null ? new Claim[] { new("BranchIds", "1") } : [new Claim("ClientTypeId", clientType), new("BranchIds", "1")];

        Assert.False(new BranchScopeResolver(AccessorWith(claims)).Resolve().IsRestricted);
    }

    [Fact]
    public void NoHttpContext_IsBackgroundWork_Unrestricted()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns((HttpContext?)null);

        Assert.False(new BranchScopeResolver(accessor).Resolve().IsRestricted);
    }

    [Fact]
    public void TheScopeIsResolvedOncePerRequest()
    {
        var accessor = AccessorWith(Staff("1"));
        var resolver = new BranchScopeResolver(accessor);

        var first = resolver.Resolve();
        // Even if the claims changed mid-request the cached scope is what the rest of the request sees.
        accessor.HttpContext!.User = new ClaimsPrincipal(new ClaimsIdentity(Staff("2")));

        Assert.Same(first, resolver.Resolve());
    }
}
