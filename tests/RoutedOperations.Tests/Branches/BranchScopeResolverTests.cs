using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Services.Branches;

namespace RoutedOperations.Tests.Branches;

public class BranchScopeResolverTests
{
    private static IHttpContextAccessor AccessorWith(params Claim[] claims)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity(claims));
        accessor.HttpContext.Returns(http);
        return accessor;
    }

    private static Claim[] Staff(string clientTypeId, string? branchIds)
    {
        var claims = new List<Claim>
        {
            new("IsNetworkPartner", "False"),
            new("ClientTypeId", clientTypeId),
        };
        if (branchIds is not null) claims.Add(new Claim("BranchIds", branchIds));
        return claims.ToArray();
    }

    [Fact]
    public void Resolve_NoHttpContext_Unrestricted()
    {
        // System / background work has no request: the rule does not apply.
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns((HttpContext?)null);

        var scope = new BranchScopeResolver(accessor).Resolve();

        Assert.False(scope.IsRestricted);
    }

    [Theory]
    [InlineData("4")]
    [InlineData("5")]
    public void Resolve_StaffWithoutClaim_Unrestricted(string clientTypeId)
    {
        var scope = new BranchScopeResolver(AccessorWith(Staff(clientTypeId, null))).Resolve();

        Assert.False(scope.IsRestricted);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Resolve_StaffWithEmptyClaim_Unrestricted(string claim)
    {
        var scope = new BranchScopeResolver(AccessorWith(Staff("4", claim))).Resolve();

        Assert.False(scope.IsRestricted);
    }

    [Theory]
    [InlineData("4")]
    [InlineData("5")]
    public void Resolve_StaffWithBranches_Restricted(string clientTypeId)
    {
        var scope = new BranchScopeResolver(AccessorWith(Staff(clientTypeId, "3, 7,3"))).Resolve();

        Assert.True(scope.IsRestricted);
        Assert.Equal(new[] { 3, 7 }, scope.BranchIds);
    }

    [Theory]
    [InlineData("3,x")]
    [InlineData("abc")]
    [InlineData("0")]
    [InlineData("-2")]
    [InlineData(",")]
    public void Resolve_MalformedClaim_FailsClosed(string claim)
    {
        var scope = new BranchScopeResolver(AccessorWith(Staff("4", claim))).Resolve();

        Assert.True(scope.IsRestricted);
        Assert.Empty(scope.BranchIds);
    }

    [Theory]
    [InlineData("2")]   // customer
    [InlineData("3")]
    [InlineData(null)]  // no ClientTypeId
    public void Resolve_NonStaff_Unrestricted_EvenWithClaim(string? clientTypeId)
    {
        // Customers / unknown callers are scoped elsewhere (NP resolver deny
        // scope, customer client scope); branches never apply to them.
        var claims = new List<Claim> { new("BranchIds", "3") };
        if (clientTypeId is not null) claims.Add(new Claim("ClientTypeId", clientTypeId));

        var scope = new BranchScopeResolver(AccessorWith(claims.ToArray())).Resolve();

        Assert.False(scope.IsRestricted);
    }

    [Fact]
    public void Resolve_NetworkPartner_Unrestricted_EvenWithClaim()
    {
        var accessor = AccessorWith(
            new Claim("IsNetworkPartner", "True"),
            new Claim("ClientTypeId", "4"),
            new Claim("NpAgentId", "42"),
            new Claim("BranchIds", "3"));

        var scope = new BranchScopeResolver(accessor).Resolve();

        Assert.False(scope.IsRestricted);
    }

    [Fact]
    public void Resolve_CachesOnHttpContextItems()
    {
        var accessor = AccessorWith(Staff("4", "3"));
        var sut = new BranchScopeResolver(accessor);

        var first = sut.Resolve();
        var second = sut.Resolve();

        Assert.Same(first, second);
        Assert.Same(first, accessor.HttpContext!.Items["BranchScope"]);
    }
}
