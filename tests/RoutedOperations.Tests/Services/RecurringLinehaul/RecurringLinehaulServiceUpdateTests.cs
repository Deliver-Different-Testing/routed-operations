using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

/// <summary>
/// Covers UpdateAsync. Same validation rules as CreateAsync but with the id-exclusion
/// on the duplicate-name check (renaming a run to its own current name must NOT trip
/// the dupe guard). Also covers the not-found short-circuit + polymorphic target /
/// mode / master-booking swaps on an existing row.
/// </summary>
public class RecurringLinehaulServiceUpdateTests
{
    private static RecurringLinehaulService NewSvc(
        out Core.Domain.DynamicDespatchDbContext seed,
        out Microsoft.EntityFrameworkCore.DbContextOptions<Core.Domain.DespatchContext> opts)
    {
        opts = RecurringLinehaulTestHarness.NewOptions();
        seed = RecurringLinehaulTestHarness.Context(opts);
        return new RecurringLinehaulService(RecurringLinehaulTestHarness.Factory(opts));
    }

    private static RecurringLinehaulService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
        => NewSvc(out seed, out _);

    private static RecurringLinehaulRunUpsertDto Valid(string name = "Run") => new()
    {
        RunName = name,
        FromDepotId = 1,
        ToDepotId = 2,
        StartTime = "08:00",
        DespatchTime = "09:00",
        DefaultTargetType = "Courier",
        DefaultTargetId = null,
        SpeedId = null,
        Mode = 1
    };

    private static void SeedDepots(Core.Domain.DynamicDespatchDbContext c)
    {
        c.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 1, Name = "A", Active = true },
            new TblBulkRegion { BulkRegionId = 2, Name = "B", Active = true },
            new TblBulkRegion { BulkRegionId = 3, Name = "C", Active = true });
        c.SaveChanges();
    }

    private static void SeedRun(Core.Domain.DynamicDespatchDbContext c, int id, string name)
    {
        c.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = id, RunName = name, FromDepotId = 1, ToDepotId = 2, Mode = 1
        });
        c.SaveChanges();
    }

    [Fact]
    public async Task UpdateAsync_MissingRunReturnsNotFound()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);

        var res = await svc.UpdateAsync(999, Valid());

        Assert.True(res.NotFound);
    }

    [Fact]
    public async Task UpdateAsync_ValidationFailurePropagates()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        SeedRun(seed, 1, "Existing");
        var dto = Valid(); dto.RunName = "";

        var res = await svc.UpdateAsync(1, dto);

        Assert.Equal("Run name is required.", res.ValidationError);
    }

    [Fact]
    public async Task UpdateAsync_RenamingToOwnCurrentNameDoesNotTripDupeCheck()
    {
        // Duplicate-name guard must exclude the current row's id when id != null.
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        SeedRun(seed, 1, "SameName");

        var res = await svc.UpdateAsync(1, Valid("SameName"));

        Assert.Null(res.ValidationError);
        Assert.NotNull(res.Dto);
    }

    [Fact]
    public async Task UpdateAsync_RenamingToAnotherRunsNameTripsDupeCheck()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        SeedRun(seed, 1, "One");
        SeedRun(seed, 2, "Two");

        var res = await svc.UpdateAsync(1, Valid("Two"));

        Assert.NotNull(res.ValidationError);
        Assert.Contains("Two", res.ValidationError!);
    }

    [Fact]
    public async Task UpdateAsync_PersistsChangedFields()
    {
        var svc = NewSvc(out var seed, out var opts);
        SeedDepots(seed);
        SeedRun(seed, 1, "Old");
        var dto = Valid("New");
        dto.FromDepotId = 3;
        dto.StartTime = "10:00";
        dto.DespatchTime = "11:00";

        await svc.UpdateAsync(1, dto);

        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        var row = verify.TblbulkLinehaulRuns.Single();
        Assert.Equal("New", row.RunName);
        Assert.Equal(3, row.FromDepotId);
        Assert.Equal(new TimeOnly(10, 0), row.StartTime);
        Assert.Equal(new TimeOnly(11, 0), row.DespatchTime);
    }

    [Fact]
    public async Task UpdateAsync_SwapsCourierToAgent()
    {
        var svc = NewSvc(out var seed, out var opts);
        SeedDepots(seed);
        seed.TucAgents.Add(new TucAgent { UcagId = 6, UcagName = "Ag6" });
        await seed.SaveChangesAsync();
        // Seed with courier default target already stamped.
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1,
            DefaultTargetType = 1, CourierId = 99
        });
        await seed.SaveChangesAsync();
        var dto = Valid(); dto.DefaultTargetType = "Agent"; dto.DefaultTargetId = 6;

        await svc.UpdateAsync(1, dto);

        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        var row = verify.TblbulkLinehaulRuns.Single();
        Assert.Equal((byte?)2, row.DefaultTargetType);
        Assert.Equal(6, row.DefaultAgentId);
        Assert.Null(row.CourierId);
    }

    [Fact]
    public async Task UpdateAsync_FlightModeWithoutFlightSpeedFails()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        SeedRun(seed, 1, "R");
        var dto = Valid(); dto.Mode = 2; dto.SpeedId = null;

        var res = await svc.UpdateAsync(1, dto);

        Assert.NotNull(res.ValidationError);
    }

    [Fact]
    public async Task UpdateAsync_DemotesExistingMasterWhenSwitching()
    {
        var svc = NewSvc(out var seed, out var opts);
        SeedDepots(seed);
        SeedRun(seed, 1, "R");
        seed.TucJobBookings.AddRange(
            new TucJobBooking
            {
                UcbkId = 100, UcbkJobNumber = "B1", UcbkActive = true,
                LinehaulRunId = 1, IsLinehaulMaster = true, CourierId = 500
            },
            new TucJobBooking
            {
                UcbkId = 200, UcbkJobNumber = "B2", UcbkActive = true
            });
        await seed.SaveChangesAsync();
        var dto = Valid(); dto.MasterBookingId = 200;

        await svc.UpdateAsync(1, dto);

        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        var old = verify.TucJobBookings.Single(b => b.UcbkId == 100);
        var newMaster = verify.TucJobBookings.Single(b => b.UcbkId == 200);
        Assert.False(old.IsLinehaulMaster);
        Assert.Null(old.LinehaulRunId);
        Assert.Null(old.CourierId);
        Assert.True(newMaster.IsLinehaulMaster);
        Assert.Equal(1, newMaster.LinehaulRunId);
    }

    [Fact]
    public async Task UpdateAsync_ClearsMasterWhenIdNull()
    {
        var svc = NewSvc(out var seed, out var opts);
        SeedDepots(seed);
        SeedRun(seed, 1, "R");
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 100, UcbkJobNumber = "B1", UcbkActive = true,
            LinehaulRunId = 1, IsLinehaulMaster = true
        });
        await seed.SaveChangesAsync();
        var dto = Valid(); dto.MasterBookingId = null;

        await svc.UpdateAsync(1, dto);

        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        var b = verify.TucJobBookings.Single();
        Assert.False(b.IsLinehaulMaster);
        Assert.Null(b.LinehaulRunId);
    }

    [Fact]
    public async Task UpdateAsync_ReturnsEnrichedDto()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        SeedRun(seed, 1, "R");

        var res = await svc.UpdateAsync(1, Valid("R2"));

        Assert.NotNull(res.Dto);
        Assert.Equal("R2", res.Dto!.RunName);
        Assert.Equal(1, res.Dto.Id);
    }

    [Fact]
    public async Task UpdateAsync_KeepingSameMasterInheritsUpdatedCourier()
    {
        var svc = NewSvc(out var seed, out var opts);
        SeedDepots(seed);
        SeedRun(seed, 1, "R");
        seed.TucCouriers.AddRange(
            new TucCourier { UccrId = 10, UccrName = "F", UccrSurname = "L", Code = "", Active = true },
            new TucCourier { UccrId = 20, UccrName = "F2", UccrSurname = "L2", Code = "", Active = true });
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 100, UcbkJobNumber = "B1", UcbkActive = true,
            LinehaulRunId = 1, IsLinehaulMaster = true, CourierId = 10
        });
        await seed.SaveChangesAsync();
        var dto = Valid();
        dto.DefaultTargetType = "Courier"; dto.DefaultTargetId = 20;
        dto.MasterBookingId = 100;

        await svc.UpdateAsync(1, dto);

        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        var b = verify.TucJobBookings.Single();
        Assert.True(b.IsLinehaulMaster);
        Assert.Equal(20, b.CourierId);
    }
}
