using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using RoutedOperations.Core.Application.Services.Region;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Region;

public class BulkRegionServiceTests
{
    private static BulkRegionService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var factory = CockpitTestHarness.Factory(opts);
        var httpAccessor = Substitute.For<IHttpContextAccessor>();
        httpAccessor.HttpContext.Returns(new DefaultHttpContext());
        var cache = new TenantScopedCache(new MemoryCache(new MemoryCacheOptions()), httpAccessor);
        return new BulkRegionService(factory, cache);
    }

    [Fact]
    public async Task GetForRunDateAsync_ReturnsOnlyActiveRegionsOrderedByName()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 1, Name = "Zulu", Active = true },
            new TblBulkRegion { BulkRegionId = 2, Name = "Alpha", Active = true },
            new TblBulkRegion { BulkRegionId = 3, Name = "Inactive", Active = false });
        await seed.SaveChangesAsync();

        var rows = await svc.GetForRunDateAsync(new DateTime(2026, 8, 13));

        Assert.Equal(2, rows.Count);
        Assert.Equal("Alpha", rows[0].Label);
        Assert.Equal(2, rows[0].Id);
        Assert.Equal("Zulu", rows[1].Label);
    }

    [Fact]
    public async Task GetForRunDateAsync_EmptyDbReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await svc.GetForRunDateAsync(new DateTime(2026, 1, 1));

        Assert.Empty(rows);
    }

    [Fact]
    public async Task GetForRunDateAsync_IgnoresRunDateArgument()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "Auckland", Active = true });
        await seed.SaveChangesAsync();

        var a = await svc.GetForRunDateAsync(new DateTime(2020, 1, 1));
        var b = await svc.GetForRunDateAsync(new DateTime(2030, 12, 31));

        Assert.Equal(a.Count, b.Count);
    }
}
