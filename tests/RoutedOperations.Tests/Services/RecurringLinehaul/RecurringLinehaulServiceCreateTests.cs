using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

/// <summary>
/// Covers CreateAsync validation + happy path. Focus is on the validation branches
/// (name required, name length, from!=to depots, despatch>=start ordering, duplicate
/// name, flight-mode requires a flight-grouped speed) and the create pipeline that
/// stamps mode / target-type / master booking when supplied.
/// </summary>
public class RecurringLinehaulServiceCreateTests
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

    private static RecurringLinehaulRunUpsertDto Valid(string name = "MyRun") => new()
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
            new TblBulkRegion { BulkRegionId = 2, Name = "B", Active = true });
        c.SaveChanges();
    }

    [Fact]
    public async Task CreateAsync_NullNameReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid(); dto.RunName = null;

        var res = await svc.CreateAsync(dto);

        Assert.Equal("Run name is required.", res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_WhitespaceNameReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid(); dto.RunName = "   ";

        var res = await svc.CreateAsync(dto);

        Assert.Equal("Run name is required.", res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_LongNameReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid(); dto.RunName = new string('x', 51);

        var res = await svc.CreateAsync(dto);

        Assert.Equal("Run name must be 50 characters or fewer.", res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_NameAtBoundaryPasses()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid(new string('x', 50));

        var res = await svc.CreateAsync(dto);

        Assert.Null(res.ValidationError);
        Assert.NotNull(res.Dto);
    }

    [Fact]
    public async Task CreateAsync_ZeroFromDepotReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid(); dto.FromDepotId = 0;

        var res = await svc.CreateAsync(dto);

        Assert.Equal("From and To depots are required.", res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_ZeroToDepotReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid(); dto.ToDepotId = 0;

        var res = await svc.CreateAsync(dto);

        Assert.Equal("From and To depots are required.", res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_FromEqualsToDepotReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid(); dto.ToDepotId = 1;

        var res = await svc.CreateAsync(dto);

        Assert.Equal("From and To depots must be different.", res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_DespatchBeforeStartReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid();
        dto.StartTime = "09:00";
        dto.DespatchTime = "08:00";

        var res = await svc.CreateAsync(dto);

        Assert.Equal("Despatch time must be at or after the start time.", res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_DespatchEqualsStartAllowed()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid();
        dto.StartTime = "08:00";
        dto.DespatchTime = "08:00";

        var res = await svc.CreateAsync(dto);

        Assert.Null(res.ValidationError);
        Assert.NotNull(res.Dto);
    }

    [Fact]
    public async Task CreateAsync_DuplicateActiveNameReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 1, RunName = "Existing", FromDepotId = 1, ToDepotId = 2, Mode = 1
        });
        await seed.SaveChangesAsync();

        var res = await svc.CreateAsync(Valid("Existing"));

        Assert.Equal("A linehaul run named \"Existing\" already exists.", res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_FlightModeMissingSpeedReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid();
        dto.Mode = 2;
        dto.SpeedId = null;

        var res = await svc.CreateAsync(dto);

        Assert.Equal(
            "A Flight-mode run needs a Flight service level - pick one under Speed (service level).",
            res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_FlightModeZeroSpeedReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid();
        dto.Mode = 2;
        dto.SpeedId = 0;

        var res = await svc.CreateAsync(dto);

        Assert.Equal(
            "A Flight-mode run needs a Flight service level - pick one under Speed (service level).",
            res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_FlightModeNonFlightGroupedSpeedReturnsValidation()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucJobTypeGroupings.Add(new TucJobTypeGrouping { GroupingId = 1, GroupingName = "Overnight" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 10, UcjtName = "Overnight Speed", GroupingId = 1 });
        await seed.SaveChangesAsync();
        var dto = Valid(); dto.Mode = 2; dto.SpeedId = 10;

        var res = await svc.CreateAsync(dto);

        Assert.Equal(
            "The selected speed isn't a Flight service level. A Flight-mode run must use a speed in the Flight grouping.",
            res.ValidationError);
    }

    [Fact]
    public async Task CreateAsync_FlightModeFlightGroupedSpeedAccepted()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucJobTypeGroupings.Add(new TucJobTypeGrouping { GroupingId = 2, GroupingName = "US Flight" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 20, UcjtName = "Priority Flight", GroupingId = 2 });
        await seed.SaveChangesAsync();
        var dto = Valid(); dto.Mode = 2; dto.SpeedId = 20;

        var res = await svc.CreateAsync(dto);

        Assert.Null(res.ValidationError);
        Assert.NotNull(res.Dto);
        Assert.Equal((byte)2, res.Dto!.Mode);
    }

    [Fact]
    public async Task CreateAsync_HappyPathPersistsRun()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);

        var res = await svc.CreateAsync(Valid("NewRun"));

        Assert.NotNull(res.Dto);
        Assert.Equal("NewRun", res.Dto!.RunName);
        Assert.Single(seed.TblbulkLinehaulRuns.ToList());
    }

    [Fact]
    public async Task CreateAsync_TrimsRunName()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid("  Padded  ");

        var res = await svc.CreateAsync(dto);

        Assert.Equal("Padded", res.Dto!.RunName);
    }

    [Fact]
    public async Task CreateAsync_MapsCourierTargetToCourierId()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 3, UccrName = "F", UccrSurname = "L", Code = "FL", Active = true });
        await seed.SaveChangesAsync();
        var dto = Valid(); dto.DefaultTargetType = "Courier"; dto.DefaultTargetId = 3;

        await svc.CreateAsync(dto);

        var row = seed.TblbulkLinehaulRuns.Single();
        Assert.Equal(3, row.CourierId);
        Assert.Null(row.DefaultAgentId);
        Assert.Equal((byte?)1, row.DefaultTargetType);
    }

    [Fact]
    public async Task CreateAsync_MapsAgentTargetToAgentId()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucAgents.Add(new TucAgent { UcagId = 6, UcagName = "Ag6", Association = "" });
        await seed.SaveChangesAsync();
        var dto = Valid(); dto.DefaultTargetType = "Agent"; dto.DefaultTargetId = 6;

        await svc.CreateAsync(dto);

        var row = seed.TblbulkLinehaulRuns.Single();
        Assert.Null(row.CourierId);
        Assert.Equal(6, row.DefaultAgentId);
        Assert.Equal((byte?)2, row.DefaultTargetType);
    }

    [Fact]
    public async Task CreateAsync_MapsNetworkPartnerTargetToAgentId()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucAgents.Add(new TucAgent { UcagId = 8, UcagName = "NP8", Association = "" });
        await seed.SaveChangesAsync();
        var dto = Valid(); dto.DefaultTargetType = "NetworkPartner"; dto.DefaultTargetId = 8;

        await svc.CreateAsync(dto);

        var row = seed.TblbulkLinehaulRuns.Single();
        Assert.Equal((byte?)3, row.DefaultTargetType);
        Assert.Equal(8, row.DefaultAgentId);
    }

    [Fact]
    public async Task CreateAsync_UnknownTargetTypeStampsNullType()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid(); dto.DefaultTargetType = "Bogus"; dto.DefaultTargetId = 5;

        await svc.CreateAsync(dto);

        var row = seed.TblbulkLinehaulRuns.Single();
        Assert.Null(row.DefaultTargetType);
        Assert.Null(row.CourierId);
        Assert.Null(row.DefaultAgentId);
    }

    [Fact]
    public async Task CreateAsync_MasterBookingLinkedOnCreate()
    {
        var svc = NewSvc(out var seed, out var opts);
        SeedDepots(seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 3, UccrName = "F", UccrSurname = "L", Code = "", Active = true });
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 100, UcbkJobNumber = "B1", UcbkActive = true
        });
        await seed.SaveChangesAsync();
        var dto = Valid();
        dto.DefaultTargetType = "Courier"; dto.DefaultTargetId = 3;
        dto.MasterBookingId = 100;

        var res = await svc.CreateAsync(dto);

        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        var booking = verify.TucJobBookings.Single();
        Assert.True(booking.IsLinehaulMaster);
        Assert.Equal(res.Dto!.Id, booking.LinehaulRunId);
        Assert.Equal(3, booking.CourierId);
    }

    [Fact]
    public async Task CreateAsync_NoMasterBookingLeavesBookingsUntouched()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 100, UcbkJobNumber = "B1", UcbkActive = true
        });
        await seed.SaveChangesAsync();

        await svc.CreateAsync(Valid("R"));

        var booking = seed.TucJobBookings.Single();
        Assert.False(booking.IsLinehaulMaster);
        Assert.Null(booking.LinehaulRunId);
    }

    [Fact]
    public async Task CreateAsync_ModeFlightNormalizedIntoRun()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        seed.TucJobTypeGroupings.Add(new TucJobTypeGrouping { GroupingId = 2, GroupingName = "Flight" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 20, UcjtName = "F", GroupingId = 2 });
        await seed.SaveChangesAsync();
        var dto = Valid(); dto.Mode = 2; dto.SpeedId = 20;

        await svc.CreateAsync(dto);

        var row = seed.TblbulkLinehaulRuns.Single();
        Assert.Equal((byte)2, row.Mode);
    }

    [Fact]
    public async Task CreateAsync_NullModeCoercesToRoad()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid(); dto.Mode = null;

        await svc.CreateAsync(dto);

        var row = seed.TblbulkLinehaulRuns.Single();
        Assert.Equal((byte)1, row.Mode);
    }

    [Fact]
    public async Task CreateAsync_ParsesStartAndDespatchTimes()
    {
        var svc = NewSvc(out var seed);
        SeedDepots(seed);
        var dto = Valid(); dto.StartTime = "07:15"; dto.DespatchTime = "07:45";

        await svc.CreateAsync(dto);

        var row = seed.TblbulkLinehaulRuns.Single();
        Assert.Equal(new TimeOnly(7, 15), row.StartTime);
        Assert.Equal(new TimeOnly(7, 45), row.DespatchTime);
    }
}
