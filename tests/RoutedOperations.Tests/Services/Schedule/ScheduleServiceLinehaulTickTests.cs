using System.Data.Common;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.Schedule;
using RoutedOperations.Core.Application.Services.Schedule;
using RoutedOperations.Core.Application.Utilities;

namespace RoutedOperations.Tests.Services.Schedule;

/// <summary>
/// UC #1115. Linehaul leg cases on the UPDATE path (ScheduleId set) that
/// ScheduleServiceTests does not cover: an unchanged NULL tick resent as NULL
/// stays NULL (D1, no silent NULL to false), and the zone % range check also
/// guards an update. The tick and tick + 0.5 resaves live in
/// ScheduleServiceTests (UpsertAsync_ticking_add_on_*).
/// </summary>
public class ScheduleServiceLinehaulTickTests : IDisposable
{
    private readonly List<DbConnection> _connections = new();
    public void Dispose() { foreach (var c in _connections) c.Dispose(); }

    private ScheduleService NewSvc()
    {
        var (opts, connection) = CockpitTestHarness.NewSqliteOptions();
        _connections.Add(connection);
        var accessor = new HttpContextAccessor();
        var cache = new TenantScopedCache(new MemoryCache(new MemoryCacheOptions()), accessor);
        return new ScheduleService(CockpitTestHarness.Factory(opts), NullLogger<ScheduleService>.Instance,
            cache, Substitute.For<IScheduleConverter>(), accessor);
    }

    private static ScheduleGroupUpsertRequest Request(bool? addOn, decimal? pct = 0m) => new()
    {
        Name = "ZB Wellington > Akl Returns",
        RegionId = 1,
        DayWindows = new List<DayWindowUpsertRequest>
        {
            new() { DayOfWeek = 1, StartTime = "08:00", EndTime = "17:00", CutoffDay = 1, CutoffTime = "15:00" },
            new() { DayOfWeek = 2, StartTime = "08:00", EndTime = "17:00", CutoffDay = 2, CutoffTime = "15:00" },
        },
        Zones = new List<ScheduleZoneUpsertRequest> { new() { Zone = 1, Active = true } },
        Linehauls = new List<ScheduleLinehaulUpsertRequest>
        {
            new()
            {
                Name = "WLG to Mainfreight AKL", FromDepotId = 1, ToDepotId = 2,
                WeekDay = new[] { 1, 1, 1, 1, 1, 0, 0 },
                Amount = 30, AmountPercentage = pct, ApplyDiscount = true, ApplyAddOnPercentage = addOn,
            },
        },
    };

    // A save without ScheduleId is a create, so a test that resaves without
    // it never reaches the update path. Kept so that trap stays visible.
    [Fact]
    public async Task UpsertAsync_without_schedule_id_creates_a_second_schedule()
    {
        var svc = NewSvc();
        var req = Request(false);
        var first = await svc.UpsertAsync(req);
        req.Linehauls![0].ApplyAddOnPercentage = true;
        var second = await svc.UpsertAsync(req);
        Assert.NotEqual(first.ScheduleId, second.ScheduleId);
    }

    [Fact]
    public async Task Update_path_resending_a_null_tick_keeps_null()
    {
        var svc = NewSvc();
        var created = await svc.UpsertAsync(Request(null));
        var resave = Request(null);
        resave.ScheduleId = created.ScheduleId;
        await svc.UpsertAsync(resave);
        Assert.Null((await svc.GetDetailAsync(created.ScheduleId)).Linehauls.Single().ApplyAddOnPercentage);
    }

    [Fact]
    public async Task Update_path_rejects_50_on_an_existing_schedule()
    {
        var svc = NewSvc();
        var created = await svc.UpsertAsync(Request(true));
        var resave = Request(true, 50m);
        resave.ScheduleId = created.ScheduleId;
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(resave));
        Assert.Contains("Enter a fraction", ex.Message);
    }
}
