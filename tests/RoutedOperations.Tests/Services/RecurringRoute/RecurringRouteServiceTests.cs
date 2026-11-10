using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.RecurringRoute;
using RoutedOperations.Core.Application.Services.RecurringRoute;
using RoutedOperations.Core.Domain.Despatch;
using RouteEntity = RoutedOperations.Core.Domain.Despatch.Route;

namespace RoutedOperations.Tests.Services.RecurringRoute;

/// <summary>
/// Not covered: GetAllZipcodeCentroidsAsync uses SqlQueryRaw against
/// SQL-Server-specific geography accessors (GeographyData.EnvelopeCenter().Lat /
/// .Long). Requires a live SQL Server. Everything else is EF LINQ + covered.
/// </summary>
public class RecurringRouteServiceTests
{
    private static RecurringRouteService NewSvc(out Core.Domain.DynamicDespatchDbContext seed, string? email = null)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var accessor = Substitute.For<IHttpContextAccessor>();
        var claims = new List<Claim>();
        if (email is not null) claims.Add(new Claim(ClaimTypes.Email, email));
        var ctx = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims)),
        };
        accessor.HttpContext.Returns(ctx);
        return new RecurringRouteService(CockpitTestHarness.Factory(opts), accessor);
    }

    [Fact]
    public async Task GetAllAsync_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await svc.GetAllAsync();

        Assert.Empty(rows);
    }

    [Fact]
    public async Task GetAllAsync_ProjectsRouteFields()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.Add(new TucCourier
        {
            UccrId = 1, Code = "C1", UccrName = "Bob", Active = true,
        });
        seed.Routes.Add(new RouteEntity
        {
            RouteId = 10, Name = "R", Area = "SF",
            DefaultTargetType = 1, DefaultCourierId = 1,
            Active = true, CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        await seed.SaveChangesAsync();

        var rows = await svc.GetAllAsync();

        var row = Assert.Single(rows);
        Assert.Equal(10, row.RouteId);
        Assert.Equal("R", row.Name);
        Assert.Equal("C1 Bob", row.DefaultTargetName);
    }

    [Fact]
    public async Task GetAllAsync_ResolvesAgentDefaultTarget()
    {
        var svc = NewSvc(out var seed);
        seed.TucAgents.Add(new TucAgent { UcagId = 5, UcagName = "Agent-5" });
        seed.Routes.Add(new RouteEntity
        {
            RouteId = 1, Name = "R", Area = "",
            DefaultTargetType = 2, DefaultAgentId = 5,
            Active = true, CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        await seed.SaveChangesAsync();

        var row = (await svc.GetAllAsync()).Single();

        Assert.Equal(5, row.DefaultTargetId);
        Assert.Equal("Agent-5", row.DefaultTargetName);
    }

    [Fact]
    public async Task GetAllAsync_NoDefaultTargetReturnsEmptyName()
    {
        var svc = NewSvc(out var seed);
        seed.Routes.Add(new RouteEntity
        {
            RouteId = 1, Name = "R", Area = "",
            DefaultTargetType = null, Active = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        await seed.SaveChangesAsync();

        var row = (await svc.GetAllAsync()).Single();

        Assert.Null(row.DefaultTargetId);
        Assert.Equal(string.Empty, row.DefaultTargetName);
    }

    [Fact]
    public async Task GetByIdAsync_ReturnsMatch()
    {
        var svc = NewSvc(out var seed);
        seed.Routes.Add(new RouteEntity
        {
            RouteId = 42, Name = "R", Area = "",
            Active = true, CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        await seed.SaveChangesAsync();

        var row = await svc.GetByIdAsync(42);

        Assert.NotNull(row);
        Assert.Equal(42, row!.RouteId);
    }

    [Fact]
    public async Task GetByIdAsync_MissingReturnsNull()
    {
        var svc = NewSvc(out _);

        var row = await svc.GetByIdAsync(999);

        Assert.Null(row);
    }

    [Fact]
    public async Task CreateAsync_MinimalRoutePersists()
    {
        var svc = NewSvc(out _, email: "kev@x");

        var created = await svc.CreateAsync(new UpsertRouteRequest(
            Name: "New route", Area: "SF",
            DefaultTargetType: null, DefaultTargetId: null,
            ScheduleIds: new List<int>(), Active: true,
            ZipPolygonIds: new List<int>()));

        Assert.NotNull(created);
        Assert.Equal("New route", created!.Name);
    }

    [Fact]
    public async Task CreateAsync_MissingNameThrows()
    {
        var svc = NewSvc(out _);

        Assert.Throws<InvalidOperationException>(() =>
            svc.CreateAsync(new UpsertRouteRequest(
                Name: string.Empty, Area: "", null, null,
                new List<int>(), true, new List<int>())).GetAwaiter().GetResult());
    }

    [Fact]
    public async Task CreateAsync_InvalidTargetTypeThrows()
    {
        var svc = NewSvc(out _);

        Assert.Throws<InvalidOperationException>(() =>
            svc.CreateAsync(new UpsertRouteRequest(
                "R", "", DefaultTargetType: 9, DefaultTargetId: 1,
                new List<int>(), true, new List<int>())).GetAwaiter().GetResult());
    }

    [Fact]
    public async Task CreateAsync_TargetTypeSetWithoutIdThrows()
    {
        var svc = NewSvc(out _);

        Assert.Throws<InvalidOperationException>(() =>
            svc.CreateAsync(new UpsertRouteRequest(
                "R", "", DefaultTargetType: 1, DefaultTargetId: null,
                new List<int>(), true, new List<int>())).GetAwaiter().GetResult());
    }

    [Fact]
    public async Task CreateAsync_AttachesZipsWhenIdsProvided()
    {
        var svc = NewSvc(out var seed);
        seed.ZipPolygons.Add(new ZipPolygon { ZipPolygonId = 1, Zip = "94100" });
        await seed.SaveChangesAsync();

        var created = await svc.CreateAsync(new UpsertRouteRequest(
            "R", "", null, null,
            new List<int>(), true, new List<int> { 1 }));

        Assert.Single(created!.Zipcodes);
    }

    [Fact]
    public async Task UpdateAsync_MissingRouteReturnsNull()
    {
        var svc = NewSvc(out _);

        var updated = await svc.UpdateAsync(999, new UpsertRouteRequest(
            "R", "", null, null,
            new List<int>(), true, new List<int>()));

        Assert.Null(updated);
    }

    [Fact]
    public async Task UpdateAsync_UpdatesFields()
    {
        var svc = NewSvc(out var seed);
        seed.Routes.Add(new RouteEntity
        {
            RouteId = 1, Name = "Old", Area = "", Active = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        await seed.SaveChangesAsync();

        var updated = await svc.UpdateAsync(1, new UpsertRouteRequest(
            "New", "New Area", null, null,
            new List<int>(), false, new List<int>()));

        Assert.NotNull(updated);
        Assert.Equal("New", updated!.Name);
        Assert.False(updated.Active);
    }

    [Fact]
    public async Task CopyAsync_MissingSourceReturnsNull()
    {
        var svc = NewSvc(out _);

        var copy = await svc.CopyAsync(999, new CopyRouteRequest(
            "Copy", null, null, null, CopyZipcodes: false));

        Assert.Null(copy);
    }

    [Fact]
    public async Task CopyAsync_HappyPath()
    {
        var svc = NewSvc(out var seed);
        seed.Routes.Add(new RouteEntity
        {
            RouteId = 1, Name = "Src", Area = "A", Active = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        await seed.SaveChangesAsync();

        var copy = await svc.CopyAsync(1, new CopyRouteRequest(
            "Copy", null, null, null, CopyZipcodes: false));

        Assert.NotNull(copy);
        Assert.Equal("Copy", copy!.Name);
    }

    [Fact]
    public async Task SoftDeleteAsync_MissingReturnsFalse()
    {
        var svc = NewSvc(out _);

        Assert.False(await svc.SoftDeleteAsync(999));
    }

    [Fact]
    public async Task SoftDeleteAsync_SetsActiveFalse()
    {
        var svc = NewSvc(out var seed);
        seed.Routes.Add(new RouteEntity
        {
            RouteId = 1, Name = "R", Area = "", Active = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        await seed.SaveChangesAsync();

        Assert.True(await svc.SoftDeleteAsync(1));
    }

    [Fact]
    public async Task GetRosterAsync_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await svc.GetRosterAsync(1);

        Assert.Empty(rows);
    }

    [Fact]
    public async Task GetRosterAsync_ProjectsCourierAndAgentNames()
    {
        var svc = NewSvc(out var seed);
        seed.Routes.Add(new RouteEntity
        {
            RouteId = 1, Name = "R", Area = "", Active = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        seed.TucCouriers.Add(new TucCourier { UccrId = 5, Code = "5", UccrName = "C5", Active = true });
        seed.TucAgents.Add(new TucAgent { UcagId = 8, UcagName = "A8" });
        seed.DispatchRouteRosters.AddRange(
            new DispatchRouteRoster
            {
                RouteRosterId = 1, RouteId = 1, TargetType = 1, CourierId = 5,
                RosterDate = new DateTime(2026, 8, 20), IsActive = true,
                CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
            },
            new DispatchRouteRoster
            {
                RouteRosterId = 2, RouteId = 1, TargetType = 2, AgentId = 8,
                DayOfWeek = 3, IsActive = true,
                CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
            });
        await seed.SaveChangesAsync();

        var rows = await svc.GetRosterAsync(1);

        Assert.Equal(2, rows.Count);
        Assert.Contains(rows, r => r.TargetName == "5 C5");
        Assert.Contains(rows, r => r.TargetName == "A8");
    }

    [Fact]
    public async Task AddRosterAsync_BothDateAndDowThrows()
    {
        var svc = NewSvc(out _);

        Assert.Throws<InvalidOperationException>(() =>
            svc.AddRosterAsync(1, new UpsertRouteRosterRequest(
                TargetType: 1, TargetId: 1,
                RosterDate: new DateTime(2026, 1, 1), DayOfWeek: 3))
                .GetAwaiter().GetResult());
    }

    [Fact]
    public async Task AddRosterAsync_NeitherDateNorDowThrows()
    {
        var svc = NewSvc(out _);

        Assert.Throws<InvalidOperationException>(() =>
            svc.AddRosterAsync(1, new UpsertRouteRosterRequest(
                TargetType: 1, TargetId: 1,
                RosterDate: null, DayOfWeek: null))
                .GetAwaiter().GetResult());
    }

    [Fact]
    public async Task AddRosterAsync_DeactivatesCollidingActiveDateRow()
    {
        var svc = NewSvc(out var seed);
        seed.Routes.Add(new RouteEntity
        {
            RouteId = 1, Name = "R", Area = "", Active = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        seed.TucCouriers.Add(new TucCourier { UccrId = 5, Code = "5", UccrName = "X", Active = true });
        seed.DispatchRouteRosters.Add(new DispatchRouteRoster
        {
            RouteRosterId = 1, RouteId = 1, TargetType = 1, CourierId = 5,
            RosterDate = new DateTime(2026, 8, 20), IsActive = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        await seed.SaveChangesAsync();

        var newRow = await svc.AddRosterAsync(1, new UpsertRouteRosterRequest(
            TargetType: 1, TargetId: 5,
            RosterDate: new DateTime(2026, 8, 20), DayOfWeek: null));

        Assert.NotNull(newRow);
    }

    [Fact]
    public async Task DeleteRosterAsync_MissingReturnsFalse()
    {
        var svc = NewSvc(out _);

        Assert.False(await svc.DeleteRosterAsync(1, 999));
    }

    [Fact]
    public async Task DeleteRosterAsync_SoftDeletesActive()
    {
        var svc = NewSvc(out var seed);
        seed.DispatchRouteRosters.Add(new DispatchRouteRoster
        {
            RouteRosterId = 1, RouteId = 1, TargetType = 1, CourierId = 5, IsActive = true,
            RosterDate = DateTime.Today, CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        });
        await seed.SaveChangesAsync();

        Assert.True(await svc.DeleteRosterAsync(1, 1));
    }

    [Fact]
    public async Task SearchZipcodesAsync_EmptyQueryReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await svc.SearchZipcodesAsync(string.Empty);

        Assert.Empty(rows);
    }

    [Fact]
    public async Task SearchZipcodesAsync_ReturnsPrefixMatches()
    {
        var svc = NewSvc(out var seed);
        seed.ZipPolygons.AddRange(
            new ZipPolygon { ZipPolygonId = 1, Zip = "94100" },
            new ZipPolygon { ZipPolygonId = 2, Zip = "94200" },
            new ZipPolygon { ZipPolygonId = 3, Zip = "10000" });
        await seed.SaveChangesAsync();

        var rows = await svc.SearchZipcodesAsync("941");

        Assert.Single(rows);
        Assert.Equal("94100", rows[0].Zip);
    }

    [Fact]
    public async Task GetPolygonShapesAsync_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await svc.GetPolygonShapesAsync(Array.Empty<int>());

        Assert.Empty(rows);
    }

    [Fact]
    public async Task GetPolygonShapesAsync_ReturnsMatches()
    {
        var svc = NewSvc(out var seed);
        seed.ZipPolygons.Add(new ZipPolygon { ZipPolygonId = 1, Zip = "941", Wkt = "POLYGON((0 0))" });
        await seed.SaveChangesAsync();

        var rows = await svc.GetPolygonShapesAsync(new[] { 1, 1 });

        Assert.Single(rows);
    }

    [Fact]
    public async Task GetAssignableTargetsAsync_SegmentsCouriersAgentsAndNps()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, Code = "1", UccrName = "C", Active = true });
        seed.TucAgents.AddRange(
            new TucAgent { UcagId = 2, UcagName = "Agent", IsNetworkPartner = false },
            new TucAgent { UcagId = 3, UcagName = "NP", IsNetworkPartner = true });
        await seed.SaveChangesAsync();

        var res = await svc.GetAssignableTargetsAsync();

        Assert.Single(res.Couriers);
        Assert.Single(res.Agents);
        Assert.Single(res.Nps);
        Assert.Equal("Agent", res.Agents[0].Name);
        Assert.Equal("NP", res.Nps[0].Name);
    }

    // ─── Schedule picker (M1: B1 + D1, 2026-11-10) ───
    //
    // The picker used to group day rows by (Name, Start, End, ClientId,
    // Region, SpeedId) and drop AutoBook rows. AutoBook schedules carry routes
    // on prod (all 8 Medical bindings), so hiding them made those schedules
    // unbindable from Routed Ops. The Id it submits must stay a DAY-ROW id,
    // because tblRouteSchedule and the resolver key on it.

    private static TblBulkRunSchedule DayRow(int id, int headerId, short day,
        bool? autoBook = false, int startHour = 8, int? clientId = null) => new()
    {
        BulkRunScheduleId = id, ScheduleId = headerId, Name = $"view name {headerId}",
        ClientId = clientId, Region = 1, SpeedId = 1, DayOfWeek = day,
        StartTime = new TimeSpan(startHour, 0, 0), EndTime = new TimeSpan(startHour + 2, 0, 0),
        AutoBook = autoBook,
    };

    private static BulkRunScheduleHeader Header(int id, string name,
        bool isActive = true, DateTime? retiredUtc = null) => new()
    {
        ScheduleId = id, Name = name, IsDefault = true, IsActive = isActive,
        RetiredUtc = retiredUtc, CreatedUtc = DateTime.UtcNow, CreatedBy = "test",
    };

    [Fact]
    public async Task GetSchedulesLookupAsync_lists_auto_book_schedules()
    {
        // D1: the filter is gone. A schedule whose every day row is AutoBook
        // (#949 Fresh Connection Whangarei, the reported case) must be pickable.
        var svc = NewSvc(out var seed);
        seed.BulkRunScheduleHeaders.Add(Header(949, "Fresh Connection Whangarei"));
        seed.TblBulkRunSchedules.AddRange(
            DayRow(5001, 949, 1, autoBook: true),
            DayRow(5002, 949, 3, autoBook: true));
        await seed.SaveChangesAsync();

        var s = Assert.Single(await svc.GetSchedulesLookupAsync());

        Assert.Equal(949, s.HeaderId);
        Assert.Equal("Fresh Connection Whangarei", s.Name);
    }

    [Fact]
    public async Task GetSchedulesLookupAsync_gives_one_entry_per_header_keyed_on_its_lowest_live_day_row()
    {
        // Two day rows with DIFFERENT windows on one header used to split into
        // two picker entries under the old group key. Now one entry, and its
        // Id is the lowest live day-row id, never the header id. A blanked row
        // (no window) is not live and cannot be the representative.
        var svc = NewSvc(out var seed);
        seed.BulkRunScheduleHeaders.Add(Header(7, "Header seven"));
        var blanked = DayRow(10, 7, 2);
        blanked.StartTime = null;
        blanked.EndTime = null;
        seed.TblBulkRunSchedules.AddRange(
            blanked,
            DayRow(12, 7, 1, startHour: 8),
            DayRow(11, 7, 3, startHour: 14),
            DayRow(13, 7, 5, startHour: 8));
        await seed.SaveChangesAsync();

        var s = Assert.Single(await svc.GetSchedulesLookupAsync());

        Assert.Equal(11, s.Id);
        Assert.NotEqual(s.HeaderId, s.Id);
        Assert.Equal(7, s.HeaderId);
        // Window shown is the representative row's.
        Assert.Equal("14:00", s.StartTime);
        Assert.Equal(new[] { 1, 3, 5 }, s.Days.ToArray());
        // The header's name, not the view row's.
        Assert.Equal("Header seven", s.Name);
    }

    [Fact]
    public async Task GetSchedulesLookupAsync_excludes_retired_and_flags_inactive()
    {
        // Retired headers are gone for good. Inactive ones stay pickable,
        // because the resolver does not read IsActive and binding a route
        // before activation does no harm; the flag lets the UI say so.
        var svc = NewSvc(out var seed);
        seed.BulkRunScheduleHeaders.AddRange(
            Header(1, "Live"),
            Header(2, "Retired", retiredUtc: DateTime.UtcNow.AddDays(-1)),
            Header(3, "Paused", isActive: false));
        seed.TblBulkRunSchedules.AddRange(
            DayRow(101, 1, 1), DayRow(201, 2, 1), DayRow(301, 3, 1));
        await seed.SaveChangesAsync();

        var lookup = await svc.GetSchedulesLookupAsync();

        Assert.Equal(new[] { "Live", "Paused" }, lookup.Select(s => s.Name).ToArray());
        Assert.True(lookup.Single(s => s.HeaderId == 1).IsActive);
        Assert.False(lookup.Single(s => s.HeaderId == 3).IsActive);
    }

    [Fact]
    public async Task GetSchedulesLookupAsync_takes_client_codes_from_the_schedule_client_junction()
    {
        // The view's ClientId is NULL on schedules created since the junction,
        // so codes must come from tblScheduleClient or every new client
        // schedule shows no client at all. The day row's ClientId is ignored.
        var svc = NewSvc(out var seed);
        seed.TucClients.AddRange(
            new TucClient { UcclId = 41, UcclCode = "ZED", UcclName = "Zed" },
            new TucClient { UcclId = 42, UcclCode = "ABC", UcclName = "Abc" },
            new TucClient { UcclId = 43, UcclCode = "LEGACY", UcclName = "Legacy" });
        seed.BulkRunScheduleHeaders.AddRange(Header(1, "Linked"), Header(2, "Default"));
        seed.ScheduleClients.AddRange(
            new ScheduleClient { ScheduleId = 1, ClientId = 41, CreatedUtc = DateTime.UtcNow, CreatedBy = "t" },
            new ScheduleClient { ScheduleId = 1, ClientId = 42, CreatedUtc = DateTime.UtcNow, CreatedBy = "t" });
        seed.TblBulkRunSchedules.AddRange(
            DayRow(101, 1, 1, clientId: null),
            DayRow(201, 2, 1, clientId: 43));
        await seed.SaveChangesAsync();

        var lookup = await svc.GetSchedulesLookupAsync();

        Assert.Equal(new[] { "ABC", "ZED" }, lookup.Single(s => s.HeaderId == 1).ClientCodes.ToArray());
        Assert.Empty(lookup.Single(s => s.HeaderId == 2).ClientCodes);
    }

    [Fact]
    public async Task GetAllAsync_route_schedules_carry_the_header_id_for_the_roster_tab()
    {
        // N3: the Roster tab compared the bound DAY-ROW id with the schedule's
        // HEADER id, so a route showed on whichever schedule's header id
        // happened to equal its day-row id (Medical #8 showed #7's route).
        // The binding has to expose its header for a header-to-header match.
        var svc = NewSvc(out var seed);
        seed.BulkRunScheduleHeaders.AddRange(Header(7, "Seven"), Header(8, "Eight"));
        var bound = DayRow(8, 7, 4);
        seed.TblBulkRunSchedules.Add(bound);
        var route = new RouteEntity
        {
            RouteId = 1, Name = "R", Area = "", Active = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
        };
        route.Schedules.Add(bound);
        seed.Routes.Add(route);
        await seed.SaveChangesAsync();

        var s = Assert.Single((await svc.GetAllAsync()).Single().Schedules);

        Assert.Equal(8, s.ScheduleId);
        Assert.Equal(7, s.HeaderId);
    }

    [Fact]
    public async Task GetMappedStopsAsync_ReturnsProjection()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 1, UcjtName = "Std", ShortName = "S", GroupingId = 10 });
        seed.Set<TucJobTypeGrouping>().Add(new TucJobTypeGrouping { GroupingId = 10, GroupingName = "SameCourier" });
        seed.Set<TucJobStatus>().Add(new TucJobStatus { UcjsId = 0, UcjsName = "New" });
        var job = new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", BookDate = new DateTime(2026, 8, 13),
            BookTime = new DateTime(2026, 8, 13), ClientId = 1, Speed = 1,
            FromAddress = "F", ToAddress = "T", JobStatus = 0,
        };
        job.RouteId = 5;
        seed.TblBulkJobs.Add(job);
        await seed.SaveChangesAsync();

        var rows = await svc.GetMappedStopsAsync(5);

        Assert.Single(rows);
        Assert.Equal("Std", rows[0].SpeedName);
    }

    [Fact]
    public async Task GetBookingsAsync_ReturnsActiveBookings()
    {
        var svc = NewSvc(out var seed);
        seed.TucClients.Add(new TucClient { UcclId = 1 });
        seed.TucJobBookings.Add(new TucJobBooking
        {
            UcbkId = 1, UcbkClientId = 1,
            UcbkActive = true, UcbkDone = false,
            UcbkTime = new DateTime(2026, 8, 13),
            RouteId = 42,
            UcbkDays = "Mon",
        });
        await seed.SaveChangesAsync();

        var rows = await svc.GetBookingsAsync(42);

        Assert.Single(rows);
        Assert.Equal(1, rows[0].Id);
    }
}
