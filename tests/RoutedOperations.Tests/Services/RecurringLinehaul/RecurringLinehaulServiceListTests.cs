using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

/// <summary>
/// Covers ListAsync + GetAsync + the EnrichAsync parallel-fanout that both feed. Focus is on the
/// projection: depot name lookup, courier / agent target resolution, master booking label,
/// mapped-stops count, used-by-schedules count (dedupe across weekday variants), and mode/speed
/// pass-through. GetAsync is a single-row wrap of the same pipeline.
/// </summary>
public class RecurringLinehaulServiceListTests
{
    private static RecurringLinehaulService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = RecurringLinehaulTestHarness.NewOptions();
        seed = RecurringLinehaulTestHarness.Context(opts);
        return new RecurringLinehaulService(RecurringLinehaulTestHarness.Factory(opts));
    }

    private static void SeedDepots(Core.Domain.DynamicDespatchDbContext c, params (int id, string name)[] depots)
    {
        foreach (var d in depots)
        {
            c.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = d.id, Name = d.name, Active = true });
        }
    }

    [Fact]
    public async Task ListAsync_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await svc.ListAsync();

        Assert.Empty(rows);
    }

    [Fact]
    public async Task ListAsync_OrdersRunsByName()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.AddRange(
            new TblbulkLinehaulRun { Id = 1, RunName = "Zeta", FromDepotId = 1, ToDepotId = 2, Mode = 1 },
            new TblbulkLinehaulRun { Id = 2, RunName = "Alpha", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var rows = await svc.ListAsync();

        Assert.Equal(new[] { "Alpha", "Zeta" }, rows.Select(r => r.RunName).ToArray());
    }

    [Fact]
    public async Task ListAsync_ResolvesFromAndToDepotNames()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "Auckland"), (2, "Wellington"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 10, RunName = "AK->WN", FromDepotId = 1, ToDepotId = 2, Mode = 1
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal("Auckland", row.FromDepotName);
        Assert.Equal("Wellington", row.ToDepotName);
    }

    [Fact]
    public async Task ListAsync_MissingDepotNameFallsBackToEmptyString()
    {
        var svc = NewSvc(out var seed);
        // Only From depot present; To depot id 99 does not exist.
        SeedDepots(seed, (1, "Auckland"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 10, RunName = "Orphan", FromDepotId = 1, ToDepotId = 99, Mode = 1
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal(string.Empty, row.ToDepotName);
    }

    [Fact]
    public async Task ListAsync_FormatsStartAndDespatchTimesAsHHmm()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2,
            StartTime = new TimeOnly(8, 30),
            DespatchTime = new TimeOnly(9, 15),
            Mode = 1
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal("08:30", row.StartTime);
        Assert.Equal("09:15", row.DespatchTime);
    }

    [Fact]
    public async Task ListAsync_NullStartAndDespatchTimesRemainNull()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Null(row.StartTime);
        Assert.Null(row.DespatchTime);
    }

    [Fact]
    public async Task ListAsync_ModeZeroCoercesToRoad()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 0 });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal((byte)1, row.Mode);
    }

    [Fact]
    public async Task ListAsync_ModeFlightPreserved()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 2 });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal((byte)2, row.Mode);
    }

    [Fact]
    public async Task ListAsync_CourierTargetResolvesNameAndCode()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TucCouriers.Add(new TucCourier { UccrId = 5, UccrName = "Ada", UccrSurname = "Lovelace", Code = "AL", Active = true });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1,
            DefaultTargetType = 1, CourierId = 5
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal("Courier", row.DefaultTargetType);
        Assert.Equal(5, row.DefaultTargetId);
        Assert.Equal("Ada Lovelace", row.DefaultTargetName);
        Assert.Equal("AL", row.DefaultTargetHint);
    }

    [Fact]
    public async Task ListAsync_CourierBackfillWhenTypeByteIsNull()
    {
        // Legacy rows: CourierId set but DefaultTargetType byte not yet stamped.
        // EnrichAsync should synthesize the "Courier" type from the presence
        // of a non-null CourierId (see the "?? (r.CourierId > 0 ? \"Courier\" : null)").
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TucCouriers.Add(new TucCourier { UccrId = 5, UccrName = "Ada", UccrSurname = "Lovelace", Code = "AL", Active = true });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1,
            DefaultTargetType = null, CourierId = 5
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal("Courier", row.DefaultTargetType);
        Assert.Equal("Ada Lovelace", row.DefaultTargetName);
    }

    [Fact]
    public async Task ListAsync_AgentTargetResolvesAgentNameAndAssociationHint()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TucAgents.Add(new TucAgent { UcagId = 7, UcagName = "AgentZ", Association = "NP Alpha" });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1,
            DefaultTargetType = 2, DefaultAgentId = 7
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal("Agent", row.DefaultTargetType);
        Assert.Equal(7, row.DefaultTargetId);
        Assert.Equal("AgentZ", row.DefaultTargetName);
        Assert.Equal("NP Alpha", row.DefaultTargetHint);
    }

    [Fact]
    public async Task ListAsync_NetworkPartnerTargetResolvesToAgent()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TucAgents.Add(new TucAgent { UcagId = 9, UcagName = "NP-Nine", Association = "hint" });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1,
            DefaultTargetType = 3, DefaultAgentId = 9
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal("NetworkPartner", row.DefaultTargetType);
        Assert.Equal(9, row.DefaultTargetId);
        Assert.Equal("NP-Nine", row.DefaultTargetName);
    }

    [Fact]
    public async Task ListAsync_UnboundTargetLeavesFieldsNull()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1,
            DefaultTargetType = null, CourierId = null, DefaultAgentId = null
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Null(row.DefaultTargetType);
        Assert.Null(row.DefaultTargetId);
        Assert.Null(row.DefaultTargetName);
        Assert.Null(row.DefaultTargetHint);
    }

    [Fact]
    public async Task ListAsync_MappedStopsExcludesVoidJobs()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 42, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.TblBulkJobs.AddRange(
            new TblBulkJob { BulkJobId = 1, JobNumber = "J1", LinehaulRunId = 42, Void = false, BookDate = DateTime.Today, BookTime = DateTime.Today },
            new TblBulkJob { BulkJobId = 2, JobNumber = "J2", LinehaulRunId = 42, Void = false, BookDate = DateTime.Today, BookTime = DateTime.Today },
            new TblBulkJob { BulkJobId = 3, JobNumber = "J3", LinehaulRunId = 42, Void = true, BookDate = DateTime.Today, BookTime = DateTime.Today });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal(2, row.MappedStopsCount);
    }

    [Fact]
    public async Task ListAsync_MappedStopsZeroWhenNoJobs()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 42, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal(0, row.MappedStopsCount);
    }

    [Fact]
    public async Task ListAsync_UsedBySchedulesDedupesWeekdayVariants()
    {
        // Same schedule (Name + ClientId) split into two DOW rows should count once.
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 42, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.TblBulkRunSchedules.AddRange(
            new TblBulkRunSchedule { BulkRunScheduleId = 1, Name = "Nightly", ClientId = 100, DayOfWeek = 1 },
            new TblBulkRunSchedule { BulkRunScheduleId = 2, Name = "Nightly", ClientId = 100, DayOfWeek = 2 });
        seed.TblBulkScheduleLinehauls.AddRange(
            new TblBulkScheduleLinehaul { Id = 1, LinehaulRunId = 42, BulkRunScheduleId = 1, Active = true, Name = "leg" },
            new TblBulkScheduleLinehaul { Id = 2, LinehaulRunId = 42, BulkRunScheduleId = 2, Active = true, Name = "leg" });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal(1, row.UsedBySchedulesCount);
        Assert.True(row.Active);
    }

    [Fact]
    public async Task ListAsync_UsedBySchedulesCountsDistinctLogicalSchedules()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 42, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.TblBulkRunSchedules.AddRange(
            new TblBulkRunSchedule { BulkRunScheduleId = 1, Name = "SchedA", ClientId = 100 },
            new TblBulkRunSchedule { BulkRunScheduleId = 2, Name = "SchedB", ClientId = 100 });
        seed.TblBulkScheduleLinehauls.AddRange(
            new TblBulkScheduleLinehaul { Id = 1, LinehaulRunId = 42, BulkRunScheduleId = 1, Active = true, Name = "leg" },
            new TblBulkScheduleLinehaul { Id = 2, LinehaulRunId = 42, BulkRunScheduleId = 2, Active = true, Name = "leg" });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal(2, row.UsedBySchedulesCount);
    }

    [Fact]
    public async Task ListAsync_UsedBySchedulesIgnoresInactiveBindings()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 42, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule { BulkRunScheduleId = 1, Name = "SchedA", ClientId = 100 });
        seed.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
        {
            Id = 1, LinehaulRunId = 42, BulkRunScheduleId = 1, Active = false, Name = "leg"
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal(0, row.UsedBySchedulesCount);
        Assert.False(row.Active);
    }

    [Fact]
    public async Task ListAsync_MasterBookingLabelResolvesJobNumberAndName()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 42, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 900, UcbkJobNumber = "LH-900", CustomJobName = "MasterRun",
            LinehaulRunId = 42, IsLinehaulMaster = true, UcbkActive = true
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal(900, row.MasterBookingId);
        Assert.Equal("LH-900 - MasterRun", row.MasterBookingLabel);
    }

    [Fact]
    public async Task ListAsync_NoMasterBookingLeavesFieldsNull()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 42, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Null(row.MasterBookingId);
        Assert.Null(row.MasterBookingLabel);
    }

    [Fact]
    public async Task GetAsync_ReturnsNullWhenMissing()
    {
        var svc = NewSvc(out _);

        var row = await svc.GetAsync(999);

        Assert.Null(row);
    }

    [Fact]
    public async Task GetAsync_ReturnsSingleRunEnriched()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "AKL"), (2, "WLG"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 7, RunName = "GetMe", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var row = await svc.GetAsync(7);

        Assert.NotNull(row);
        Assert.Equal("GetMe", row!.RunName);
        Assert.Equal("AKL", row.FromDepotName);
    }

    [Fact]
    public async Task ListAsync_RunWithNullNameMapsToEmptyString()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 1, RunName = null, FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal(string.Empty, row.RunName);
    }

    [Fact]
    public async Task ListAsync_SpeedIdPassesThrough()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1, SpeedId = 55
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal(55, row.SpeedId);
    }

    [Fact]
    public async Task ListAsync_MasterBookingLabelUsesJobNumberOnlyWhenNameAndClientBlank()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed, (1, "A"), (2, "B"));
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun { Id = 42, RunName = "R", FromDepotId = 1, ToDepotId = 2, Mode = 1 });
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 900, UcbkJobNumber = "LH-900", CustomJobName = null,
            LinehaulRunId = 42, IsLinehaulMaster = true, UcbkActive = true
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListAsync()).Single();

        Assert.Equal("LH-900", row.MasterBookingLabel);
    }
}
