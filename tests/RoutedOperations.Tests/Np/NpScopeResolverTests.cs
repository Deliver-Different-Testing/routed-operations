using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Np;

public class NpScopeResolverTests
{
    private static IHttpContextAccessor AccessorWith(params Claim[] claims)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity(claims));
        accessor.HttpContext.Returns(http);
        return accessor;
    }

    private static IDbContextFactory<DynamicDespatchDbContext> FactoryFor(DynamicDespatchDbContext ctx)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContextAsync().Returns(ctx);
        return factory;
    }

    private static DynamicDespatchDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<DynamicDespatchDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new DynamicDespatchDbContext(options);
    }

    [Fact]
    public async Task ResolveAsync_MissingHttpContext_Throws()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns((HttpContext?)null);
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeResolver(accessor, factory);

        await Assert.ThrowsAsync<InvalidOperationException>(() => sut.ResolveAsync());
    }

    [Fact]
    public async Task ResolveAsync_ClientTypeId5_ReturnsAdminScope()
    {
        var accessor = AccessorWith(new Claim("ClientTypeId", "5"));
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeResolver(accessor, factory);

        var scope = await sut.ResolveAsync();

        Assert.True(scope.IsAdmin);
        Assert.Null(scope.NpAgentId);
    }

    [Fact]
    public async Task ResolveAsync_TenantStaff_NotNp_ReturnsAdminScope()
    {
        var accessor = AccessorWith(new Claim("IsNetworkPartner", "False"));
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeResolver(accessor, factory);

        var scope = await sut.ResolveAsync();

        Assert.True(scope.IsAdmin);
        Assert.Null(scope.NpAgentId);
    }

    [Fact]
    public async Task ResolveAsync_NoNpClaimAtAll_ReturnsAdminScope()
    {
        // Absent IsNetworkPartner claim also flows into the tenant-staff branch
        // because string.Equals(null, "True") is false.
        var accessor = AccessorWith();
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeResolver(accessor, factory);

        var scope = await sut.ResolveAsync();

        Assert.True(scope.IsAdmin);
    }

    [Fact]
    public async Task ResolveAsync_NpWithClaimAgentId_ReturnsNpScope()
    {
        var accessor = AccessorWith(
            new Claim("IsNetworkPartner", "True"),
            new Claim("NpAgentId", "42"));
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeResolver(accessor, factory);

        var scope = await sut.ResolveAsync();

        Assert.False(scope.IsAdmin);
        Assert.Equal(42, scope.NpAgentId);
    }

    [Fact]
    public async Task ResolveAsync_NpMissingAgentIdClaim_FallsBackToTucClientLookup()
    {
        var accessor = AccessorWith(
            new Claim("IsNetworkPartner", "True"),
            new Claim("ClientID", "7"));

        await using var ctx = NewContext();
        ctx.TucClients.Add(new TucClient { UcclId = 7, NpAgentId = 99 });
        await ctx.SaveChangesAsync();
        var factory = FactoryFor(ctx);
        var sut = new NpScopeResolver(accessor, factory);

        var scope = await sut.ResolveAsync();

        Assert.False(scope.IsAdmin);
        Assert.Equal(99, scope.NpAgentId);
    }

    [Fact]
    public async Task ResolveAsync_NpMissingAgentIdClaim_NoRow_ReturnsDegenerateScope()
    {
        var accessor = AccessorWith(
            new Claim("IsNetworkPartner", "True"),
            new Claim("ClientID", "7"));

        await using var ctx = NewContext();
        // No TucClient row for id 7.
        await ctx.SaveChangesAsync();
        var factory = FactoryFor(ctx);
        var sut = new NpScopeResolver(accessor, factory);

        var scope = await sut.ResolveAsync();

        Assert.False(scope.IsAdmin);
        Assert.Null(scope.NpAgentId);
    }

    [Fact]
    public async Task ResolveAsync_NpMissingAgentIdClaim_RowWithNullAgentId_ReturnsDegenerateScope()
    {
        var accessor = AccessorWith(
            new Claim("IsNetworkPartner", "True"),
            new Claim("ClientID", "7"));

        await using var ctx = NewContext();
        ctx.TucClients.Add(new TucClient { UcclId = 7, NpAgentId = null });
        await ctx.SaveChangesAsync();
        var factory = FactoryFor(ctx);
        var sut = new NpScopeResolver(accessor, factory);

        var scope = await sut.ResolveAsync();

        Assert.False(scope.IsAdmin);
        Assert.Null(scope.NpAgentId);
    }

    [Fact]
    public async Task ResolveAsync_NpWithoutClientIdClaim_ReturnsDegenerateScope()
    {
        var accessor = AccessorWith(new Claim("IsNetworkPartner", "True"));
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeResolver(accessor, factory);

        var scope = await sut.ResolveAsync();

        Assert.False(scope.IsAdmin);
        Assert.Null(scope.NpAgentId);
        // No DB call should have been made because ClientID claim was missing.
        await factory.DidNotReceive().CreateDbContextAsync();
    }

    [Fact]
    public async Task ResolveAsync_TwiceInSameRequest_UsesCachedResult()
    {
        // Rule: HttpContext.Items caches the scope so the DB fallback path
        // is not re-run on the second call within a request.
        var accessor = AccessorWith(
            new Claim("IsNetworkPartner", "True"),
            new Claim("ClientID", "7"));

        await using var ctx = NewContext();
        ctx.TucClients.Add(new TucClient { UcclId = 7, NpAgentId = 55 });
        await ctx.SaveChangesAsync();
        var factory = FactoryFor(ctx);
        var sut = new NpScopeResolver(accessor, factory);

        var first = await sut.ResolveAsync();
        var second = await sut.ResolveAsync();

        Assert.Equal(first, second);
        Assert.Equal(55, second.NpAgentId);
        // Only ONE DB context creation - the second call is cached.
        await factory.Received(1).CreateDbContextAsync();
    }

    [Fact]
    public async Task ResolveAsync_AdminBranch_DoesNotHitDb()
    {
        var accessor = AccessorWith(new Claim("ClientTypeId", "5"));
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeResolver(accessor, factory);

        await sut.ResolveAsync();
        await sut.ResolveAsync();

        await factory.DidNotReceive().CreateDbContextAsync();
    }

    [Fact]
    public async Task ResolveAsync_NpAgentIdClaimUnparseable_FallsBackToDb()
    {
        var accessor = AccessorWith(
            new Claim("IsNetworkPartner", "True"),
            new Claim("NpAgentId", "not-a-number"),
            new Claim("ClientID", "7"));

        await using var ctx = NewContext();
        ctx.TucClients.Add(new TucClient { UcclId = 7, NpAgentId = 77 });
        await ctx.SaveChangesAsync();
        var factory = FactoryFor(ctx);
        var sut = new NpScopeResolver(accessor, factory);

        var scope = await sut.ResolveAsync();

        Assert.False(scope.IsAdmin);
        Assert.Equal(77, scope.NpAgentId);
    }
}
