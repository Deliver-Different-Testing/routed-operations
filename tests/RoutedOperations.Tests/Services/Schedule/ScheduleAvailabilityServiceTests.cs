using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Schedule;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Schedule;

/// <summary>
/// Covers Steve F19b's next-available-collection resolver (2026-09-24).
///
/// EF InMemory here: the SUT's fnScheduleForClient TVF is not available
/// under InMemory, so the service detects the non-SQL provider and
/// falls back to a direct tblBulkRunSchedule read. That loses the
/// per-client override COALESCE layer, which is fine here because none
/// of the five cases below need to exercise an override row - they
/// exercise the walk-forward algorithm (operating-day mask, cutoff
/// timing, holiday skip vs. respect-opt-out).
///
/// Anchor week for the fixture: Mon 2026-09-28 through Sun 2026-10-04.
/// Every schedule row uses StartTime = 08:00, CutoffDay = its own DoW,
/// CutoffTime = 14:00, so the cutoff moment on any operating day is
/// "that day at 14:00 local".
/// </summary>
public class ScheduleAvailabilityServiceTests
{
    private const int ScheduleId = 100;
    private const int ClientId = 500;

    // Anchor dates. Mon 2026-09-28 was picked so DayOfWeek maths on the
    // resolver line up with a fresh week (no holiday-of-the-week noise).
    private static readonly DateTime Mon = new DateTime(2026, 9, 28);
    private static readonly DateTime Tue = new DateTime(2026, 9, 29);
    private static readonly DateTime Wed = new DateTime(2026, 9, 30);
    private static readonly DateTime Thu = new DateTime(2026, 10, 1);
    private static readonly DateTime Sat = new DateTime(2026, 10, 3);
    private static readonly DateTime NextMon = new DateTime(2026, 10, 5);

    private static ScheduleAvailabilityService NewSvc(out DynamicDespatchDbContext seed, out DbContextOptions<DespatchContext> opts)
    {
        opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        return new ScheduleAvailabilityService(CockpitTestHarness.Factory(opts));
    }

    private static async Task SeedMondayToFridayAsync(DynamicDespatchDbContext seed)
    {
        seed.BulkRunScheduleHeaders.Add(new BulkRunScheduleHeader
        {
            ScheduleId = ScheduleId,
            Name = "Test",
            IsDefault = true,
            IsActive = true,
            CreatedUtc = DateTime.UtcNow,
            CreatedBy = "seed",
        });
        // Mon..Fri = DayOfWeek 1..5 (ISO). Each row's cutoff pair is
        // (own DoW, 14:00) so "cutoff on day X" = "X at 14:00".
        for (short dow = 1; dow <= 5; dow++)
        {
            seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule
            {
                BulkRunScheduleId = dow,
                ScheduleId = ScheduleId,
                Name = "Test",
                DayOfWeek = dow,
                StartTime = new TimeSpan(8, 0, 0),
                EndTime = new TimeSpan(17, 0, 0),
                CutoffDay = (byte)dow,
                CutoffTime = new TimeSpan(14, 0, 0),
                CutoffHours = 0,
            });
        }
        await seed.SaveChangesAsync();
    }

    [Fact]
    public async Task HappyPath_ReturnsSameDay_NoRoll()
    {
        var svc = NewSvc(out var seed, out _);
        await SeedMondayToFridayAsync(seed);

        var result = await svc.GetNextAvailableCollectionAsync(
            ScheduleId, ClientId,
            bookingRequestedAt: Wed.AddHours(12), // Wed 12:00
            skipHolidays: false);

        Assert.NotNull(result);
        Assert.Equal(Wed.AddHours(8), result!.NextCollectionAt);
        Assert.Equal("no-roll", result.Reason);
    }

    [Fact]
    public async Task CutoffPassed_RollsToNextOperatingDay()
    {
        var svc = NewSvc(out var seed, out _);
        await SeedMondayToFridayAsync(seed);

        var result = await svc.GetNextAvailableCollectionAsync(
            ScheduleId, ClientId,
            bookingRequestedAt: Wed.AddHours(15), // Wed 15:00 > Wed 14:00 cutoff
            skipHolidays: false);

        Assert.NotNull(result);
        Assert.Equal(Thu.AddHours(8), result!.NextCollectionAt);
        Assert.Equal("cutoff-passed", result.Reason);
    }

    [Fact]
    public async Task NonOperatingDay_RollsForward()
    {
        var svc = NewSvc(out var seed, out _);
        await SeedMondayToFridayAsync(seed);

        var result = await svc.GetNextAvailableCollectionAsync(
            ScheduleId, ClientId,
            bookingRequestedAt: Sat.AddHours(9), // Sat 09:00, Sat + Sun off
            skipHolidays: false);

        Assert.NotNull(result);
        Assert.Equal(NextMon.AddHours(8), result!.NextCollectionAt);
        Assert.Equal("non-operating-day", result.Reason);
    }

    [Fact]
    public async Task SkipHolidays_RollsPast()
    {
        var svc = NewSvc(out var seed, out _);
        await SeedMondayToFridayAsync(seed);
        // Holiday on Mon 2026-09-28. CanBook = false marks it as a
        // no-book day per the calendar's semantics.
        seed.TblHolidays.Add(new TblHoliday
        {
            HolidayID = 1,
            Name = "Test Holiday",
            SiteID = 1,
            Date = Mon,
            CanBook = false,
        });
        await seed.SaveChangesAsync();

        var result = await svc.GetNextAvailableCollectionAsync(
            ScheduleId, ClientId,
            bookingRequestedAt: Mon.AddHours(5), // Mon 05:00, before cutoff
            skipHolidays: true);

        Assert.NotNull(result);
        Assert.Equal(Tue.AddHours(8), result!.NextCollectionAt);
        Assert.Equal("holiday-rolled", result.Reason);
    }

    [Fact]
    public async Task RespectHolidayOptOut_DoesNotRoll()
    {
        var svc = NewSvc(out var seed, out _);
        await SeedMondayToFridayAsync(seed);
        seed.TblHolidays.Add(new TblHoliday
        {
            HolidayID = 1,
            Name = "Test Holiday",
            SiteID = 1,
            Date = Mon,
            CanBook = false,
        });
        await seed.SaveChangesAsync();

        // skipHolidays = false honours the client's HolidayDeliveryOption
        // (Steve 2026-09-24: F19b defers to the caller, does not override
        // it). Mon 05:00 is before the Mon 14:00 cutoff so the resolver
        // returns Mon 08:00 with no roll.
        var result = await svc.GetNextAvailableCollectionAsync(
            ScheduleId, ClientId,
            bookingRequestedAt: Mon.AddHours(5),
            skipHolidays: false);

        Assert.NotNull(result);
        Assert.Equal(Mon.AddHours(8), result!.NextCollectionAt);
        Assert.Equal("no-roll", result.Reason);
    }
}
