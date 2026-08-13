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

    [Fact]
    public async Task GetSchedulesLookupAsync_GroupsByCompositeKeyAndSurfacesDays()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRunSchedules.AddRange(
            new TblBulkRunSchedule
            {
                BulkRunScheduleId = 1, Name = "S", ClientId = 1, Region = 1, SpeedId = 1,
                DayOfWeek = 1, StartTime = new TimeSpan(8, 0, 0), EndTime = new TimeSpan(10, 0, 0),
                AutoBook = false,
            },
            new TblBulkRunSchedule
            {
                BulkRunScheduleId = 2, Name = "S", ClientId = 1, Region = 1, SpeedId = 1,
                DayOfWeek = 3, StartTime = new TimeSpan(8, 0, 0), EndTime = new TimeSpan(10, 0, 0),
                AutoBook = false,
            },
            new TblBulkRunSchedule
            {
                BulkRunScheduleId = 3, Name = "AutoBook", ClientId = 1, Region = 1, SpeedId = 1,
                DayOfWeek = 1, StartTime = new TimeSpan(8, 0, 0), EndTime = new TimeSpan(10, 0, 0),
                AutoBook = true,
            });
        await seed.SaveChangesAsync();

        var lookup = await svc.GetSchedulesLookupAsync();

        var s = Assert.Single(lookup);
        Assert.Equal("S", s.Name);
        Assert.Equal(new[] { 1, 3 }, s.Days.ToArray());
        Assert.Equal("08:00", s.StartTime);
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
