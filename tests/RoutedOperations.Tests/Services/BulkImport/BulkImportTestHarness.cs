using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.BulkImport;

// Shared InMemory-EF plumbing for BulkImport service tests. Mirrors the
// RecurringLinehaulTestHarness shape used elsewhere in this project so the
// two families of tests keep the same seed / read / assert pattern.
//
// The tests need three moving parts:
//  1. An InMemory DbContextFactory that hands out fresh contexts over one
//     uniquely-named store per test.
//  2. A concrete TenantScopedCache backed by a real IMemoryCache + real
//     HttpContextAccessor so caching + invalidation is exercised end-to-end.
//     Cache hits vs misses are load-bearing on TemplateService + AddressService.
//  3. An IHttpContextAccessor that surfaces CountryCode / Internal /
//     TimeZone / CurrentTenantID claims so tenant-branching code paths
//     (US vs NZ) run their intended path per test.
internal static class BulkImportTestHarness
{
    internal static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    internal static DynamicDespatchDbContext Context(DbContextOptions<DespatchContext> options) =>
        new(options);

    internal static IDbContextFactory<DynamicDespatchDbContext> Factory(DbContextOptions<DespatchContext> options)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(options));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(options)));
        return factory;
    }

    // Build an accessor with the exact claim set the caller needs. Passing
    // null / omitting a claim leaves it absent so the SUT sees its default
    // behaviour (e.g. no CountryCode => IsNzTenant / IsUsTenant both false).
    internal static IHttpContextAccessor Accessor(
        string countryCode = null,
        string internalClaim = null,
        string timeZone = null,
        string tenantId = "1")
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        var claims = new List<Claim>();
        if (countryCode != null) claims.Add(new Claim("CountryCode", countryCode));
        if (internalClaim != null) claims.Add(new Claim("Internal", internalClaim));
        if (timeZone != null) claims.Add(new Claim("TimeZone", timeZone));
        if (tenantId != null) claims.Add(new Claim("CurrentTenantID", tenantId));
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(claims));
        accessor.HttpContext.Returns(ctx);
        return accessor;
    }

    // Cache with a real memory backing store; each test gets its own instance
    // so cross-test cache pollution can't happen even if the same key is used.
    internal static TenantScopedCache Cache(IHttpContextAccessor accessor) =>
        new(new MemoryCache(new MemoryCacheOptions()), accessor);
}
