using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using RoutedOperations.Core.Application.Utilities;

namespace RoutedOperations.Tests.Utilities;

public class TenantScopedCacheTests
{
    private static (TenantScopedCache Sut, IMemoryCache Backing, IHttpContextAccessor Accessor) NewSut(string? tenantId)
    {
        var backing = new MemoryCache(new MemoryCacheOptions());
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        if (tenantId is not null)
        {
            ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("CurrentTenantID", tenantId),
            }));
        }
        accessor.HttpContext.Returns(ctx);
        return (new TenantScopedCache(backing, accessor), backing, accessor);
    }

    [Fact]
    public async Task GetOrSetAsync_MissThenHit_FactoryCalledOnce()
    {
        var (sut, _, _) = NewSut("42");
        var calls = 0;

        var a = await sut.GetOrSetAsync<string>("x", TimeSpan.FromMinutes(5), () =>
        {
            calls++;
            return Task.FromResult("value");
        });
        var b = await sut.GetOrSetAsync<string>("x", TimeSpan.FromMinutes(5), () =>
        {
            calls++;
            return Task.FromResult("value2");
        });

        Assert.Equal("value", a);
        Assert.Equal("value", b);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task GetOrSetAsync_DifferentTenants_KeyIsolated()
    {
        var (svcA, backing, accessorA) = NewSut("1");
        var svcB = new TenantScopedCache(backing, TenantAccessor("2"));

        var a = await svcA.GetOrSetAsync<string>("shared", TimeSpan.FromMinutes(5), () => Task.FromResult("A"));
        var b = await svcB.GetOrSetAsync<string>("shared", TimeSpan.FromMinutes(5), () => Task.FromResult("B"));

        Assert.Equal("A", a);
        Assert.Equal("B", b);
    }

    [Fact]
    public async Task GetOrSetAsync_MissingClaim_BypassesCache()
    {
        // 2026-09-17 audit CRITICAL #1: the previous "anon" fallback let
        // non-HTTP callers (hosted services, warmup, cron) share a
        // single cache slot across every tenant. The wrapper now returns
        // null from TryBuildKey and GetOrSetAsync bypasses the cache
        // entirely - factory runs, nothing is stored, nothing is shared.
        var (sut, backing, _) = NewSut(null);
        var calls = 0;

        var a = await sut.GetOrSetAsync<string>("k", TimeSpan.FromMinutes(5), () =>
        {
            calls++;
            return Task.FromResult("v");
        });
        // Second call MUST NOT hit the cache - factory runs again.
        var b = await sut.GetOrSetAsync<string>("k", TimeSpan.FromMinutes(5), () =>
        {
            calls++;
            return Task.FromResult("v2");
        });

        Assert.Equal("v", a);
        Assert.Equal("v2", b);
        Assert.Equal(2, calls);
        Assert.False(backing.TryGetValue("tanon:k", out _), "no 'anon' slot should ever be written");
    }

    [Fact]
    public void Invalidate_MissingClaim_IsSafe()
    {
        // With no HttpContext.User claim, Invalidate is a no-op instead
        // of throwing / removing a cross-tenant "anon" slot.
        var (sut, _, _) = NewSut(null);
        var ex = Record.Exception(() => sut.Invalidate("k"));
        Assert.Null(ex);
    }

    [Fact]
    public async Task Invalidate_RemovesTenantScopedKey()
    {
        var (sut, _, _) = NewSut("7");
        await sut.GetOrSetAsync<string>("k", TimeSpan.FromMinutes(5), () => Task.FromResult("v"));

        sut.Invalidate("k");

        var calls = 0;
        await sut.GetOrSetAsync<string>("k", TimeSpan.FromMinutes(5), () =>
        {
            calls++;
            return Task.FromResult("re-loaded");
        });
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task GetOrSetAsync_SlidingFalse_UsesAbsoluteExpiration()
    {
        var (sut, backing, _) = NewSut("1");

        await sut.GetOrSetAsync<string>("abs", TimeSpan.FromMilliseconds(1),
            () => Task.FromResult("v"), sliding: false);

        // Wait past expiry.
        await Task.Delay(50);
        var calls = 0;
        var v = await sut.GetOrSetAsync<string>("abs", TimeSpan.FromMinutes(5),
            () =>
            {
                calls++;
                return Task.FromResult("re");
            });
        Assert.Equal(1, calls);
        Assert.Equal("re", v);
    }

    [Fact]
    public async Task GetOrSetAsync_NullValueTreatedAsMiss()
    {
        var (sut, _, _) = NewSut("1");
        var calls = 0;
        await sut.GetOrSetAsync<string?>("k", TimeSpan.FromMinutes(5), () =>
        {
            calls++;
            return Task.FromResult<string?>(null);
        });
        await sut.GetOrSetAsync<string?>("k", TimeSpan.FromMinutes(5), () =>
        {
            calls++;
            return Task.FromResult<string?>("value");
        });
        Assert.Equal(2, calls);
    }

    private static IHttpContextAccessor TenantAccessor(string tenantId)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("CurrentTenantID", tenantId),
            }))
        };
        accessor.HttpContext.Returns(ctx);
        return accessor;
    }
}
