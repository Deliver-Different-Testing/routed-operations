using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

/// <summary>
/// Covers CopyAsync: not-found + " (copy)" suffix + auto-increment suffix on collision +
/// truncation to 50 chars + property carry-over. Copy always sets Mode=Road when the
/// source has Mode=0 legacy.
/// </summary>
public class RecurringLinehaulServiceCopyTests
{
    private static RecurringLinehaulService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = RecurringLinehaulTestHarness.NewOptions();
        seed = RecurringLinehaulTestHarness.Context(opts);
        return new RecurringLinehaulService(RecurringLinehaulTestHarness.Factory(opts));
    }

    private static void SeedDepots(Core.Domain.DynamicDespatchDbContext c)
    {
        c.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 1, Name = "A", Active = true },
            new TblBulkRegion { BulkRegionId = 2, Name = "B", Active = true });
        c.SaveChanges();
    }

    [Fact]
    public async Task CopyAsync_MissingRunReturnsNotFound()
    {
        var svc = NewSvc(out _);

        var res = await svc.CopyAsync(999);

        Assert.True(res.NotFound);
    }

    [Fact]
    public async Task CopyAsync_AddsCopySuffix()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "Nightly", FromDepotId = 1, ToDepotId = 2, Mode = 1
        });
        await seed.SaveChangesAsync();

        var res = await svc.CopyAsync(1);

        Assert.NotNull(res.Dto);
        Assert.Equal("Nightly (copy)", res.Dto!.RunName);
    }

    [Fact]
    public async Task CopyAsync_AutoIncrementsWhenBaseCopyExists()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TblbulkLinehaulRuns.AddRange(
            new TblbulkLinehaulRun { Id = 1, RunName = "Nightly", FromDepotId = 1, ToDepotId = 2, Mode = 1 },
            new TblbulkLinehaulRun { Id = 2, RunName = "Nightly (copy)", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var res = await svc.CopyAsync(1);

        Assert.Equal("Nightly (copy) 2", res.Dto!.RunName);
    }

    [Fact]
    public async Task CopyAsync_AutoIncrementsAgainWhenChainExists()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TblbulkLinehaulRuns.AddRange(
            new TblbulkLinehaulRun { Id = 1, RunName = "N", FromDepotId = 1, ToDepotId = 2, Mode = 1 },
            new TblbulkLinehaulRun { Id = 2, RunName = "N (copy)", FromDepotId = 1, ToDepotId = 2, Mode = 1 },
            new TblbulkLinehaulRun { Id = 3, RunName = "N (copy) 2", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var res = await svc.CopyAsync(1);

        Assert.Equal("N (copy) 3", res.Dto!.RunName);
    }

    [Fact]
    public async Task CopyAsync_TruncatesLongNameToFiftyChars()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        // 45-char base + " (copy)" = 52 chars -> truncated to 50.
        var baseName = new string('x', 45);
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = baseName, FromDepotId = 1, ToDepotId = 2, Mode = 1
        });
        await seed.SaveChangesAsync();

        var res = await svc.CopyAsync(1);

        Assert.Equal(50, res.Dto!.RunName.Length);
    }

    [Fact]
    public async Task CopyAsync_CarriesOverDepotsAndTargets()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 3, UccrName = "F", UccrSurname = "L", Code = "", Active = true });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "S", FromDepotId = 1, ToDepotId = 2, Mode = 2,
            DefaultTargetType = 1, CourierId = 3, SpeedId = 55,
            StartTime = new TimeOnly(6, 0), DespatchTime = new TimeOnly(7, 30)
        });
        await seed.SaveChangesAsync();

        await svc.CopyAsync(1);

        var copy = seed.TblbulkLinehaulRuns.Single(r => r.Id != 1);
        Assert.Equal(1, copy.FromDepotId);
        Assert.Equal(2, copy.ToDepotId);
        Assert.Equal((byte?)1, copy.DefaultTargetType);
        Assert.Equal(3, copy.CourierId);
        Assert.Equal(55, copy.SpeedId);
        Assert.Equal(new TimeOnly(6, 0), copy.StartTime);
        Assert.Equal(new TimeOnly(7, 30), copy.DespatchTime);
        Assert.Equal((byte)2, copy.Mode);
    }

    [Fact]
    public async Task CopyAsync_ModeZeroLegacyPromotesToRoad()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "S", FromDepotId = 1, ToDepotId = 2, Mode = 0
        });
        await seed.SaveChangesAsync();

        await svc.CopyAsync(1);

        var copy = seed.TblbulkLinehaulRuns.Single(r => r.Id != 1);
        Assert.Equal((byte)1, copy.Mode);
    }

    [Fact]
    public async Task CopyAsync_ReturnsEnrichedDto()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "S", FromDepotId = 1, ToDepotId = 2, Mode = 1
        });
        await seed.SaveChangesAsync();

        var res = await svc.CopyAsync(1);

        Assert.NotNull(res.Dto);
        Assert.NotEqual(1, res.Dto!.Id);
        Assert.Equal("A", res.Dto.FromDepotName);
    }
}
