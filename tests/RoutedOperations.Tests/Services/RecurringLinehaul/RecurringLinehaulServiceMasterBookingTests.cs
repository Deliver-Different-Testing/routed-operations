using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

/// <summary>
/// Covers SearchLinkableBookingsAsync + GetScheduleBindingsAsync. Search: minimum-2-char
/// guard, prefix vs exact match ordering, cap at 50 rows, LinkedToThisRun flag flip.
/// Bindings: dedupe schedule-name variants, weekday label building, name fallback chain.
/// </summary>
public class RecurringLinehaulServiceMasterBookingTests
{
    private static RecurringLinehaulService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = RecurringLinehaulTestHarness.NewOptions();
        seed = RecurringLinehaulTestHarness.Context(opts);
        return new RecurringLinehaulService(RecurringLinehaulTestHarness.Factory(opts));
    }

    // ── SearchLinkableBookingsAsync ───────────────────────────────────────

    [Fact]
    public async Task SearchLinkableBookings_NullTermReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var res = await svc.SearchLinkableBookingsAsync(1, null);

        Assert.Empty(res);
    }

    [Fact]
    public async Task SearchLinkableBookings_SingleCharTermReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var res = await svc.SearchLinkableBookingsAsync(1, "a");

        Assert.Empty(res);
    }

    [Fact]
    public async Task SearchLinkableBookings_WhitespaceTermReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var res = await svc.SearchLinkableBookingsAsync(1, "  ");

        Assert.Empty(res);
    }

    [Fact]
    public async Task SearchLinkableBookings_SkipsInactiveBookings()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "AB123", UcbkActive = false
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "AB");

        Assert.Empty(res);
    }

    [Fact]
    public async Task SearchLinkableBookings_SkipsChildBookings()
    {
        // ParentId != null means this row is a child job and is never a linehaul
        // master candidate.
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "AB123", UcbkActive = true, ParentId = 999
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "AB");

        Assert.Empty(res);
    }

    [Fact]
    public async Task SearchLinkableBookings_MatchesByJobNumberSubstring()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "XYZ-ABC-123", UcbkActive = true
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "ABC");

        Assert.Single(res);
        Assert.Equal(1, res[0].BookingId);
    }

    [Fact]
    public async Task SearchLinkableBookings_MatchesByCustomJobName()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "AAA", CustomJobName = "Freight Widgets", UcbkActive = true
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "Widgets");

        Assert.Single(res);
    }

    [Fact]
    public async Task SearchLinkableBookings_MatchesByFromAddressStreetName()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "AAA", UcbkActive = true,
            FromAddressStreetName = "Queen Street"
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "Queen");

        Assert.Single(res);
    }

    [Fact]
    public async Task SearchLinkableBookings_MatchesByToAddressStreetName()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "AAA", UcbkActive = true,
            ToAddressStreetName = "Market Rd"
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "Market");

        Assert.Single(res);
    }

    [Fact]
    public async Task SearchLinkableBookings_MatchesByPickupAddressLine1()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "AAA", UcbkActive = true,
            PickupAddressLine1 = "42 Depot Way"
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "Depot");

        Assert.Single(res);
    }

    [Fact]
    public async Task SearchLinkableBookings_MatchesByDeliveryAddressLine1()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "AAA", UcbkActive = true,
            DeliveryAddressLine1 = "13 Depot Cres"
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "Depot");

        Assert.Single(res);
    }

    [Fact]
    public async Task SearchLinkableBookings_ExactJobNumberMatchOrderedFirst()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.AddRange(
            new TucJobBooking { UcbkId = 1, UcbkJobNumber = "AB123-X", UcbkActive = true, UcbkTime = new DateTime(2026, 1, 1) },
            new TucJobBooking { UcbkId = 2, UcbkJobNumber = "AB123",   UcbkActive = true, UcbkTime = new DateTime(2025, 1, 1) },
            new TucJobBooking { UcbkId = 3, UcbkJobNumber = "AB1234",  UcbkActive = true, UcbkTime = new DateTime(2026, 6, 1) });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "AB123");

        Assert.Equal(2, res[0].BookingId);
    }

    [Fact]
    public async Task SearchLinkableBookings_PrefixMatchesRankAboveContainsMatches()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.AddRange(
            new TucJobBooking { UcbkId = 1, UcbkJobNumber = "XX-AB-1", UcbkActive = true, UcbkTime = new DateTime(2026, 2, 1) },
            new TucJobBooking { UcbkId = 2, UcbkJobNumber = "AB-1",    UcbkActive = true, UcbkTime = new DateTime(2020, 1, 1) });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "AB");

        Assert.Equal(2, res[0].BookingId);
    }

    [Fact]
    public async Task SearchLinkableBookings_TieBreakerDescendingUcbkTime()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.AddRange(
            new TucJobBooking { UcbkId = 1, UcbkJobNumber = "AB-1", UcbkActive = true, UcbkTime = new DateTime(2025, 1, 1) },
            new TucJobBooking { UcbkId = 2, UcbkJobNumber = "AB-2", UcbkActive = true, UcbkTime = new DateTime(2026, 6, 1) });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "AB");

        Assert.Equal(2, res[0].BookingId);
    }

    [Fact]
    public async Task SearchLinkableBookings_CapsAtFiftyRows()
    {
        var svc = NewSvc(out var seed);
        for (var i = 0; i < 75; i++)
        {
            seed.TucJobBookings.Add(new TucJobBooking
            {
                UcbkId = i + 1, UcbkJobNumber = $"AB-{i:000}", UcbkActive = true,
                UcbkTime = new DateTime(2026, 1, 1).AddMinutes(i)
            });
        }
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "AB");

        Assert.Equal(50, res.Count);
    }

    [Fact]
    public async Task SearchLinkableBookings_MarksLinkedToThisRun()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "AB-1", UcbkActive = true,
            LinehaulRunId = 42, IsLinehaulMaster = true
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(42, "AB");

        Assert.True(res[0].LinkedToThisRun);
        Assert.True(res[0].IsMaster);
        Assert.Equal(42, res[0].LinkedRunId);
    }

    [Fact]
    public async Task SearchLinkableBookings_LinkedToDifferentRunFalse()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "AB-1", UcbkActive = true,
            LinehaulRunId = 42, IsLinehaulMaster = true
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(99, "AB");

        Assert.False(res[0].LinkedToThisRun);
        Assert.Equal(42, res[0].LinkedRunId);
    }

    [Fact]
    public async Task SearchLinkableBookings_ProjectsClientName()
    {
        var svc = NewSvc(out var seed);
        seed.TucClients.Add(new TucClient { UcclId = 300, UcclName = "Acme Ltd" });
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkJobNumber = "AB-1", UcbkActive = true,
            UcbkClientId = 300
        });
        await seed.SaveChangesAsync();

        var res = await svc.SearchLinkableBookingsAsync(1, "AB");

        Assert.Equal("Acme Ltd", res[0].ClientName);
    }

    // ── GetScheduleBindingsAsync ──────────────────────────────────────────

    [Fact]
    public async Task GetScheduleBindings_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var res = await svc.GetScheduleBindingsAsync(1);

        Assert.Empty(res);
    }

    [Fact]
    public async Task GetScheduleBindings_IgnoresInactive()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule { BulkRunScheduleId = 1, Name = "S" });
        seed.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
        {
            Id = 1, LinehaulRunId = 42, BulkRunScheduleId = 1, Active = false, Name = "L"
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetScheduleBindingsAsync(42);

        Assert.Empty(res);
    }

    [Fact]
    public async Task GetScheduleBindings_DedupesByScheduleNameAndClient()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRunSchedules.AddRange(
            new TblBulkRunSchedule { BulkRunScheduleId = 1, Name = "Nightly", ClientId = 10, DayOfWeek = 1 },
            new TblBulkRunSchedule { BulkRunScheduleId = 2, Name = "Nightly", ClientId = 10, DayOfWeek = 3 });
        seed.TblBulkScheduleLinehauls.AddRange(
            new TblBulkScheduleLinehaul { Id = 100, LinehaulRunId = 42, BulkRunScheduleId = 1, Active = true, Name = "L" },
            new TblBulkScheduleLinehaul { Id = 101, LinehaulRunId = 42, BulkRunScheduleId = 2, Active = true, Name = "L" });
        await seed.SaveChangesAsync();

        var res = await svc.GetScheduleBindingsAsync(42);

        Assert.Single(res);
        Assert.Equal("Nightly", res[0].Name);
    }

    [Fact]
    public async Task GetScheduleBindings_ConcatenatesWeekdayShortNamesInOrder()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRunSchedules.AddRange(
            new TblBulkRunSchedule { BulkRunScheduleId = 1, Name = "S", ClientId = 10, DayOfWeek = 3 },
            new TblBulkRunSchedule { BulkRunScheduleId = 2, Name = "S", ClientId = 10, DayOfWeek = 1 },
            new TblBulkRunSchedule { BulkRunScheduleId = 3, Name = "S", ClientId = 10, DayOfWeek = 5 });
        seed.TblBulkScheduleLinehauls.AddRange(
            new TblBulkScheduleLinehaul { Id = 1, LinehaulRunId = 42, BulkRunScheduleId = 1, Active = true, Name = "L" },
            new TblBulkScheduleLinehaul { Id = 2, LinehaulRunId = 42, BulkRunScheduleId = 2, Active = true, Name = "L" },
            new TblBulkScheduleLinehaul { Id = 3, LinehaulRunId = 42, BulkRunScheduleId = 3, Active = true, Name = "L" });
        await seed.SaveChangesAsync();

        var res = await svc.GetScheduleBindingsAsync(42);

        Assert.Equal("Mon, Wed, Fri", res[0].WeekDay);
    }

    [Fact]
    public async Task GetScheduleBindings_UnnamedBindingUsesUnnamedFallback()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
        {
            Id = 1, LinehaulRunId = 42, BulkRunScheduleId = null, Active = true, Name = null
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetScheduleBindingsAsync(42);

        Assert.Equal("(unnamed schedule)", res[0].Name);
    }

    [Fact]
    public async Task GetScheduleBindings_BindingNameUsedWhenNoSchedule()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
        {
            Id = 1, LinehaulRunId = 42, BulkRunScheduleId = null, Active = true, Name = "LegX"
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetScheduleBindingsAsync(42);

        Assert.Equal("LegX", res[0].Name);
    }

    [Fact]
    public async Task GetScheduleBindings_OrdersByName()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRunSchedules.AddRange(
            new TblBulkRunSchedule { BulkRunScheduleId = 1, Name = "Zulu",  ClientId = 10 },
            new TblBulkRunSchedule { BulkRunScheduleId = 2, Name = "Alpha", ClientId = 10 });
        seed.TblBulkScheduleLinehauls.AddRange(
            new TblBulkScheduleLinehaul { Id = 1, LinehaulRunId = 42, BulkRunScheduleId = 1, Active = true, Name = "L" },
            new TblBulkScheduleLinehaul { Id = 2, LinehaulRunId = 42, BulkRunScheduleId = 2, Active = true, Name = "L" });
        await seed.SaveChangesAsync();

        var res = await svc.GetScheduleBindingsAsync(42);

        Assert.Equal(new[] { "Alpha", "Zulu" }, res.Select(r => r.Name).ToArray());
    }

    [Fact]
    public async Task GetScheduleBindings_ActiveAlwaysTrueBecauseFilteredIn()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
        {
            Id = 1, LinehaulRunId = 42, Active = true, Name = "Solo"
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetScheduleBindingsAsync(42);

        Assert.True(res[0].Active);
    }

    [Fact]
    public async Task GetScheduleBindings_NoDayOfWeekYieldsNullWeekDay()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule { BulkRunScheduleId = 1, Name = "S", ClientId = 10 });
        seed.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
        {
            Id = 1, LinehaulRunId = 42, BulkRunScheduleId = 1, Active = true, Name = "L"
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetScheduleBindingsAsync(42);

        Assert.Null(res[0].WeekDay);
    }
}
