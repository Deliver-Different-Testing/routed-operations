using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using RoutedOperations.Core.Application.Services.Speed;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Speed;

public class SpeedServiceTests
{
    private static SpeedService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var factory = CockpitTestHarness.Factory(opts);
        var httpAccessor = Substitute.For<IHttpContextAccessor>();
        httpAccessor.HttpContext.Returns(new DefaultHttpContext());
        var cache = new TenantScopedCache(new MemoryCache(new MemoryCacheOptions()), httpAccessor);
        return new SpeedService(factory, cache);
    }

    [Fact]
    public async Task GetForRunDateAsync_ReturnsOnlySpeedsUsedOnThatDate()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobTypes.AddRange(
            new TucJobType { UcjtId = 1, UcjtName = "Standard" },
            new TucJobType { UcjtId = 2, UcjtName = "Express" });
        seed.TblBulkJobs.AddRange(
            new TblBulkJob { BulkJobId = 1, JobNumber = "J1", BookDate = new DateTime(2026, 8, 13),
                BookTime = new DateTime(2026, 8, 13, 10, 0, 0), ClientId = 1, Speed = 1 },
            new TblBulkJob { BulkJobId = 2, JobNumber = "J2", BookDate = new DateTime(2026, 8, 14),
                BookTime = new DateTime(2026, 8, 14, 10, 0, 0), ClientId = 1, Speed = 2 });
        await seed.SaveChangesAsync();

        var rows = await svc.GetForRunDateAsync(new DateTime(2026, 8, 13));

        Assert.Single(rows);
        Assert.Equal(1, rows[0].Id);
        Assert.Equal("Standard", rows[0].Label);
    }

    [Fact]
    public async Task GetForRunDateAsync_OrdersByLabel()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobTypes.AddRange(
            new TucJobType { UcjtId = 1, UcjtName = "Zulu" },
            new TucJobType { UcjtId = 2, UcjtName = "Alpha" });
        seed.TblBulkJobs.AddRange(
            new TblBulkJob { BulkJobId = 1, JobNumber = "J1", BookDate = new DateTime(2026, 8, 13),
                BookTime = new DateTime(2026, 8, 13, 10, 0, 0), ClientId = 1, Speed = 1 },
            new TblBulkJob { BulkJobId = 2, JobNumber = "J2", BookDate = new DateTime(2026, 8, 13),
                BookTime = new DateTime(2026, 8, 13, 10, 0, 0), ClientId = 1, Speed = 2 });
        await seed.SaveChangesAsync();

        var rows = await svc.GetForRunDateAsync(new DateTime(2026, 8, 13));

        Assert.Equal(new[] { "Alpha", "Zulu" }, rows.Select(x => x.Label).ToArray());
    }

    [Fact]
    public async Task GetForRunDateAsync_ReturnsEmptyWhenNothingMatches()
    {
        var svc = NewSvc(out _);

        var rows = await svc.GetForRunDateAsync(new DateTime(2026, 8, 13));

        Assert.Empty(rows);
    }

    [Fact]
    public async Task GetAllAsync_ReturnsAllTucJobTypesOrderedByName()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobTypes.AddRange(
            new TucJobType { UcjtId = 1, UcjtName = "Zulu" },
            new TucJobType { UcjtId = 2, UcjtName = "Alpha" });
        await seed.SaveChangesAsync();

        var rows = await svc.GetAllAsync();

        Assert.Equal(2, rows.Count);
        Assert.Equal("Alpha", rows[0].Label);
        Assert.Equal("Zulu", rows[1].Label);
    }

    [Fact]
    public async Task GetAllAsync_NullNameBecomesEmptyString()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 1, UcjtName = null });
        await seed.SaveChangesAsync();

        var rows = await svc.GetAllAsync();

        Assert.Single(rows);
        Assert.Equal(string.Empty, rows[0].Label);
    }
}
