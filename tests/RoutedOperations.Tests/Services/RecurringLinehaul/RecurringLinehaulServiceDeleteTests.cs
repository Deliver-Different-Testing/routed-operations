using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

/// <summary>
/// Covers DeleteAsync: not-found + 409-blocked-by-active-bindings + happy-path physical delete.
/// The blocked-by-schedules gate must count ONLY active bindings.
/// </summary>
public class RecurringLinehaulServiceDeleteTests
{
    private static RecurringLinehaulService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = RecurringLinehaulTestHarness.NewOptions();
        seed = RecurringLinehaulTestHarness.Context(opts);
        return new RecurringLinehaulService(RecurringLinehaulTestHarness.Factory(opts));
    }

    private static void SeedRun(Core.Domain.DynamicDespatchDbContext c, int id)
    {
        c.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 1, Name = "A", Active = true },
            new TblBulkRegion { BulkRegionId = 2, Name = "B", Active = true });
        c.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = id, RunName = "R" + id, FromDepotId = 1, ToDepotId = 2, Mode = 1
        });
        c.SaveChanges();
    }

    [Fact]
    public async Task DeleteAsync_MissingRunReturnsNotFound()
    {
        var svc = NewSvc(out _);

        var res = await svc.DeleteAsync(999);

        Assert.True(res.NotFound);
    }

    [Fact]
    public async Task DeleteAsync_ActiveBindingBlocks()
    {
        var svc = NewSvc(out var seed);
        SeedRun(seed, 1);
        seed.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
        {
            Id = 100, LinehaulRunId = 1, Active = true, Name = "b1"
        });
        await seed.SaveChangesAsync();

        var res = await svc.DeleteAsync(1);

        Assert.True(res.BlockedBySchedules);
        Assert.NotNull(seed.TblbulkLinehaulRuns.FirstOrDefault(r => r.Id == 1));
    }

    [Fact]
    public async Task DeleteAsync_InactiveBindingsDoNotBlock()
    {
        var svc = NewSvc(out var seed);
        SeedRun(seed, 1);
        seed.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
        {
            Id = 100, LinehaulRunId = 1, Active = false, Name = "b1"
        });
        await seed.SaveChangesAsync();

        var res = await svc.DeleteAsync(1);

        Assert.False(res.BlockedBySchedules);
        Assert.False(res.NotFound);
        Assert.Null(res.ValidationError);
    }

    [Fact]
    public async Task DeleteAsync_HappyPathRemovesRun()
    {
        var svc = NewSvc(out var seed);
        SeedRun(seed, 1);

        var res = await svc.DeleteAsync(1);

        Assert.False(res.BlockedBySchedules);
        Assert.False(res.NotFound);
        Assert.Null(res.Dto);
        Assert.Empty(seed.TblbulkLinehaulRuns.ToList());
    }

    [Fact]
    public async Task DeleteAsync_DoesNotTouchOtherRuns()
    {
        var svc = NewSvc(out var seed);
        SeedRun(seed, 1);
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 2, RunName = "R2", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        await svc.DeleteAsync(1);

        var remaining = seed.TblbulkLinehaulRuns.ToList();
        Assert.Single(remaining);
        Assert.Equal(2, remaining[0].Id);
    }
}
