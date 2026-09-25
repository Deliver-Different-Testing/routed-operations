using RoutedOperations.Core.Application.Dtos.Diagnostics;
using RoutedOperations.Core.Application.Services.Diagnostics;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Diagnostics;

/// <summary>
/// GetLogAsync is fully covered against InMemory - the paging + filter + name
/// enrichment paths are all EF LINQ. GetUnresolvedRecurringBookingsAsync is
/// intentionally skipped: it uses SqlQueryRaw which InMemory / SQLite don't
/// emulate for the datetime2 + OFFSET FETCH shape it emits.
/// </summary>
public class AutoAssignLogServiceTests
{
    private static AutoAssignLogService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        return new AutoAssignLogService(CockpitTestHarness.Factory(opts));
    }

    private static RouteAutoAssignLog Row(long id, DateTime createdUtc, string outcome = "AssignedToRoute",
        string side = "Pickup", int? routeId = null, string triggerSource = "Test")
        => new()
        {
            LogId = id,
            CreatedAtUtc = createdUtc,
            Outcome = outcome,
            Side = side,
            ResolvedRouteId = routeId,
            TriggerSource = triggerSource,
        };

    [Fact]
    public async Task GetLogAsync_EmptyReturnsEmptyPage()
    {
        var svc = NewSvc(out _);

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery());

        Assert.Equal(0, page.Total);
        Assert.Empty(page.Entries);
        Assert.Equal(1, page.Page);
        Assert.Equal(50, page.PageSize);
    }

    [Fact]
    public async Task GetLogAsync_DefaultWindowIsLast24h()
    {
        var svc = NewSvc(out var seed);
        var now = DateTime.UtcNow;
        seed.RouteAutoAssignLogs.AddRange(
            Row(1, now.AddHours(-1)),
            Row(2, now.AddHours(-48)));
        await seed.SaveChangesAsync();

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery());

        Assert.Equal(1, page.Total);
        Assert.Equal(1L, page.Entries[0].LogId);
    }

    [Fact]
    public async Task GetLogAsync_OrdersDescByCreatedAt()
    {
        var svc = NewSvc(out var seed);
        var now = DateTime.UtcNow;
        seed.RouteAutoAssignLogs.AddRange(
            Row(1, now.AddMinutes(-30)),
            Row(2, now.AddMinutes(-10)),
            Row(3, now.AddMinutes(-20)));
        await seed.SaveChangesAsync();

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery());

        Assert.Equal(new[] { 2L, 3L, 1L }, page.Entries.Select(e => e.LogId).ToArray());
    }

    [Fact]
    public async Task GetLogAsync_OutcomeFilter()
    {
        var svc = NewSvc(out var seed);
        var now = DateTime.UtcNow;
        seed.RouteAutoAssignLogs.AddRange(
            Row(1, now.AddMinutes(-5), outcome: "AssignedToRoute"),
            Row(2, now.AddMinutes(-5), outcome: "NoMatch"));
        await seed.SaveChangesAsync();

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery { Outcome = "NoMatch" });

        Assert.Single(page.Entries);
        Assert.Equal(2L, page.Entries[0].LogId);
    }

    [Fact]
    public async Task GetLogAsync_SideFilter()
    {
        var svc = NewSvc(out var seed);
        var now = DateTime.UtcNow;
        seed.RouteAutoAssignLogs.AddRange(
            Row(1, now.AddMinutes(-5), side: "Pickup"),
            Row(2, now.AddMinutes(-5), side: "Delivery"));
        await seed.SaveChangesAsync();

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery { Side = "Delivery" });

        Assert.Single(page.Entries);
        Assert.Equal(2L, page.Entries[0].LogId);
    }

    [Fact]
    public async Task GetLogAsync_RouteIdFilter()
    {
        var svc = NewSvc(out var seed);
        var now = DateTime.UtcNow;
        seed.RouteAutoAssignLogs.AddRange(
            Row(1, now.AddMinutes(-5), routeId: 100),
            Row(2, now.AddMinutes(-5), routeId: 200));
        await seed.SaveChangesAsync();

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery { RouteId = 200 });

        Assert.Single(page.Entries);
        Assert.Equal(2L, page.Entries[0].LogId);
    }

    [Fact]
    public async Task GetLogAsync_PagingClampsPageSize()
    {
        var svc = NewSvc(out var seed);
        var now = DateTime.UtcNow;
        for (long i = 1; i <= 5; i++)
            seed.RouteAutoAssignLogs.Add(Row(i, now.AddSeconds(-i)));
        await seed.SaveChangesAsync();

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery { Page = 2, PageSize = 2 });

        Assert.Equal(5, page.Total);
        Assert.Equal(2, page.Entries.Count);
        Assert.Equal(2, page.PageSize);
    }

    [Fact]
    public async Task GetLogAsync_PageSizeCappedAt200()
    {
        var svc = NewSvc(out _);

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery { PageSize = 500 });

        Assert.Equal(200, page.PageSize);
    }

    [Fact]
    public async Task GetLogAsync_ZeroPageSizeDefaultsTo50()
    {
        var svc = NewSvc(out _);

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery { PageSize = 0 });

        Assert.Equal(50, page.PageSize);
    }

    [Fact]
    public async Task GetLogAsync_NegativePageDefaultsTo1()
    {
        var svc = NewSvc(out _);

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery { Page = -3 });

        Assert.Equal(1, page.Page);
    }

    [Fact]
    public async Task GetLogAsync_ResolvesRouteAndCourierAndAgentNames()
    {
        var svc = NewSvc(out var seed);
        var now = DateTime.UtcNow;
        seed.Routes.Add(new Core.Domain.Despatch.Route
        {
            RouteId = 10, Name = "R-10", Area = "", CreatedAt = DateTime.UtcNow, CreatedBy = "sys",
            Active = true
        });
        seed.TucCouriers.Add(new TucCourier
        {
            UccrId = 20, Code = "20", UccrName = "Bob", Active = true
        });
        seed.TucAgents.Add(new TucAgent { UcagId = 30, UcagName = "Agent A" });
        seed.RouteAutoAssignLogs.Add(new RouteAutoAssignLog
        {
            LogId = 1, CreatedAtUtc = now.AddMinutes(-1),
            ResolvedRouteId = 10, ResolvedCourierId = 20, ResolvedAgentId = 30,
            ResolvedNpAgentId = 30,
            Outcome = "AssignedToRoute", Side = "Pickup", TriggerSource = "src",
            BookingKind = 4,
        });
        await seed.SaveChangesAsync();

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery());

        var e = page.Entries[0];
        Assert.Equal("R-10", e.ResolvedRouteName);
        Assert.Equal("20 Bob", e.ResolvedCourierName);
        Assert.Equal("Agent A", e.ResolvedAgentName);
        Assert.Equal("Agent A", e.ResolvedNpAgentName);
        Assert.Equal("LiveJob", e.BookingKindName);
    }

    [Fact]
    public async Task GetLogAsync_UnknownBookingKindGetsFallbackLabel()
    {
        var svc = NewSvc(out var seed);
        var now = DateTime.UtcNow;
        seed.RouteAutoAssignLogs.Add(new RouteAutoAssignLog
        {
            LogId = 1, CreatedAtUtc = now.AddMinutes(-1),
            BookingKind = 99,
            Outcome = "X", Side = "Pickup", TriggerSource = "src",
        });
        await seed.SaveChangesAsync();

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery());

        Assert.Equal("Kind 99", page.Entries[0].BookingKindName);
    }

    [Fact]
    public async Task GetLogAsync_NullBookingKindGetsUnknown()
    {
        var svc = NewSvc(out var seed);
        var now = DateTime.UtcNow;
        seed.RouteAutoAssignLogs.Add(new RouteAutoAssignLog
        {
            LogId = 1, CreatedAtUtc = now.AddMinutes(-1),
            BookingKind = null,
            Outcome = "X", Side = "Pickup", TriggerSource = "src",
        });
        await seed.SaveChangesAsync();

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery());

        Assert.Equal("Unknown", page.Entries[0].BookingKindName);
    }

    [Fact]
    public async Task GetLogAsync_CustomTimeWindowFilters()
    {
        var svc = NewSvc(out var seed);
        var anchor = new DateTime(2026, 8, 1, 12, 0, 0, DateTimeKind.Utc);
        seed.RouteAutoAssignLogs.AddRange(
            Row(1, anchor),
            Row(2, anchor.AddHours(10)),
            Row(3, anchor.AddHours(20)));
        await seed.SaveChangesAsync();

        var page = await svc.GetLogAsync(new RouteAutoAssignLogQuery
        {
            FromUtc = anchor.AddHours(5),
            ToUtc = anchor.AddHours(15),
        });

        Assert.Single(page.Entries);
        Assert.Equal(2L, page.Entries[0].LogId);
    }
}
