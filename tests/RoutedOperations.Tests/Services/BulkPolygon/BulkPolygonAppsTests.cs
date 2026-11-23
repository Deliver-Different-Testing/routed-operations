using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkPolygon;
using RoutedOperations.Core.Application.Services.BulkPolygon;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkPolygon;

/// <summary>
/// Polygon "Available to" apps (perimeter spec Part A 4.3, card polygon-available-to-apps K2):
/// the ?app= list filter, Apps on the DTO, apps on rename, the bulk set and PerimeterChanged.
/// All pure EF, so InMemory covers it. CreateAsync's app insert sits behind raw geography SQL
/// and is covered only for its validation guard here.
/// </summary>
public class BulkPolygonAppsTests
{
    private static BulkPolygonService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Email, "kev@x")])),
        });
        return new BulkPolygonService(CockpitTestHarness.Factory(opts), accessor);
    }

    private static async Task SeedAsync(Core.Domain.DynamicDespatchDbContext seed)
    {
        // 1 Schedules, 2 Auto Dispatch, 3 Schedules + Routes, 4 no app, 5 inactive Schedules.
        seed.BulkRunPolygons.AddRange(
            Poly(1, "MC1"), Poly(2, "AD Albany"), Poly(3, "MC6"), Poly(4, "Loose"), Poly(5, "Old", active: false));
        seed.BulkRunPolygonApps.AddRange(
            App(1, PolygonApps.Schedules), App(2, PolygonApps.AutoDispatch),
            App(3, PolygonApps.Routes), App(3, PolygonApps.Schedules), App(5, PolygonApps.Schedules));
        await seed.SaveChangesAsync();
    }

    private static BulkRunPolygon Poly(int id, string name, bool active = true) => new()
    {
        PolygonId = id, Name = name, Active = active, CreatedUtc = DateTime.UtcNow, CreatedBy = "s",
    };

    private static BulkRunPolygonApp App(int id, string code) => new()
    {
        PolygonId = id, AppCode = code, CreatedUtc = DateTime.UtcNow,
    };

    [Fact]
    public async Task GetAll_NoFilter_ReturnsEveryActivePolygonWithAppsInDisplayOrder()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        var rows = await svc.GetAllAsync();

        Assert.Equal(new[] { 2, 4, 1, 3 }, rows.Select(r => r.PolygonId));
        // Stored ROUTES then SCHEDULES; returned in PolygonApps.All order.
        Assert.Equal(new[] { "SCHEDULES", "ROUTES" }, rows.Single(r => r.PolygonId == 3).Apps);
        Assert.Empty(rows.Single(r => r.PolygonId == 4).Apps!);
        Assert.All(rows, r => Assert.False(r.PerimeterChanged));
    }

    [Fact]
    public async Task GetAll_AppFilter_ReturnsPolygonsWithAnyListedApp()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        var schedules = await svc.GetAllAsync(["SCHEDULES"]);
        var adOrRoutes = await svc.GetAllAsync([" autodispatch ", "ROUTES"]);

        Assert.Equal(new[] { 1, 3 }, schedules.Select(r => r.PolygonId));
        Assert.Equal(new[] { 2, 3 }, adOrRoutes.Select(r => r.PolygonId));
    }

    [Fact]
    public async Task GetAll_EmptyFilterList_MeansNoFilter()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        Assert.Equal(4, (await svc.GetAllAsync([])).Count);
    }

    [Fact]
    public async Task GetAll_UnknownApp_Throws()
    {
        var svc = NewSvc(out _);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.GetAllAsync(["RATING"]));
        Assert.Contains("RATING", ex.Message);
    }

    [Fact]
    public async Task GetById_CarriesApps()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        Assert.Equal(new[] { "AUTODISPATCH" }, (await svc.GetByIdAsync(2))!.Apps);
    }

    [Fact]
    public async Task UpdateMeta_NullApps_LeavesThemUnchanged()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        var updated = await svc.UpdateMetaAsync(3, new UpdateBulkPolygonMetaRequest("MC6 renamed"));

        Assert.Equal(new[] { "SCHEDULES", "ROUTES" }, updated!.Apps);
        Assert.False(updated.PerimeterChanged);
    }

    [Fact]
    public async Task UpdateMeta_AppsReplaceTheSet()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        var updated = await svc.UpdateMetaAsync(3,
            new UpdateBulkPolygonMetaRequest("MC6", Apps: ["AUTODISPATCH", "ROUTES", "ROUTES"]));

        Assert.Equal(new[] { "AUTODISPATCH", "ROUTES" }, updated!.Apps);
        Assert.False(updated.PerimeterChanged);
        Assert.Equal(new[] { 2, 3 }, (await svc.GetAllAsync(["AUTODISPATCH"])).Select(r => r.PolygonId));
    }

    [Fact]
    public async Task UpdateMeta_EmptyApps_ClearsEveryApp()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        var updated = await svc.UpdateMetaAsync(1, new UpdateBulkPolygonMetaRequest("MC1", Apps: []));

        Assert.Empty(updated!.Apps!);
    }

    [Fact]
    public async Task UpdateMeta_AddingOrRemovingPerimeter_FlagsPerimeterChanged()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        var added = await svc.UpdateMetaAsync(1,
            new UpdateBulkPolygonMetaRequest("MC1", Apps: ["SCHEDULES", "PERIMETER"]));
        var kept = await svc.UpdateMetaAsync(1,
            new UpdateBulkPolygonMetaRequest("MC1", Apps: ["PERIMETER"]));
        var removed = await svc.UpdateMetaAsync(1,
            new UpdateBulkPolygonMetaRequest("MC1", Apps: ["SCHEDULES"]));

        Assert.True(added!.PerimeterChanged);
        Assert.False(kept!.PerimeterChanged);
        Assert.True(removed!.PerimeterChanged);
        Assert.Equal(new[] { "SCHEDULES" }, removed.Apps);
    }

    [Fact]
    public async Task UpdateMeta_UnknownApp_ThrowsAndSavesNothing()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.UpdateMetaAsync(1, new UpdateBulkPolygonMetaRequest("Renamed", Apps: ["SCHEDULES", "NOPE"])));

        var row = await svc.GetByIdAsync(1);
        Assert.Equal("MC1", row!.Name);
        Assert.Equal(new[] { "SCHEDULES" }, row.Apps);
    }

    [Fact]
    public async Task Create_UnknownApp_ThrowsBeforeInsert()
    {
        var svc = NewSvc(out _);
        var points = new List<PolygonPointDto>
        {
            new(0, 0, -36.8, 174.7), new(0, 1, -36.8, 174.8), new(0, 2, -36.9, 174.8),
        };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.CreateAsync(new CreateBulkPolygonRequest("New", -36.8m, 174.7m, points, Apps: ["BOGUS"])));
        Assert.Contains("BOGUS", ex.Message);
    }

    [Fact]
    public async Task SetAppsBulk_AddsAndRemovesAcrossPolygons_SkipsInactiveAndUnchanged()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        // 2 already has AUTODISPATCH, 5 is inactive, 99 does not exist.
        var result = await svc.SetAppsBulkAsync(
            new BulkPolygonAppsBulkRequest([1, 2, 4, 5, 99], Add: ["AUTODISPATCH"], Remove: ["SCHEDULES"]));

        Assert.Equal(2, result.Updated);
        Assert.False(result.PerimeterChanged);
        var all = (await svc.GetAllAsync()).ToDictionary(r => r.PolygonId, r => r.Apps);
        Assert.Equal(new[] { "AUTODISPATCH" }, all[1]);
        Assert.Equal(new[] { "AUTODISPATCH" }, all[2]);
        Assert.Equal(new[] { "SCHEDULES", "ROUTES" }, all[3]);
        Assert.Equal(new[] { "AUTODISPATCH" }, all[4]);
        // The inactive polygon kept its app.
        Assert.Contains(await seed.BulkRunPolygonApps.AsNoTracking().ToListAsync(), a => a.PolygonId == 5 && a.AppCode == "SCHEDULES");
    }

    [Fact]
    public async Task SetAppsBulk_Perimeter_FlagsPerimeterChanged()
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        var on = await svc.SetAppsBulkAsync(new BulkPolygonAppsBulkRequest([1, 3], Add: ["PERIMETER"]));
        var again = await svc.SetAppsBulkAsync(new BulkPolygonAppsBulkRequest([1, 3], Add: ["PERIMETER"]));
        var off = await svc.SetAppsBulkAsync(new BulkPolygonAppsBulkRequest([3], Remove: ["PERIMETER"]));

        Assert.Equal(new BulkPolygonAppsBulkResult(2, true), on);
        Assert.Equal(new BulkPolygonAppsBulkResult(0, false), again);
        Assert.Equal(new BulkPolygonAppsBulkResult(1, true), off);
    }

    [Theory]
    [InlineData(new int[0], new[] { "ROUTES" }, new string[0], "at least one")]
    [InlineData(new[] { 1 }, new[] { "ROUTES" }, new[] { "routes" }, "both added and removed")]
    [InlineData(new[] { 1 }, new[] { "X" }, new string[0], "Unknown polygon app")]
    public async Task SetAppsBulk_BadRequest_Throws(int[] ids, string[] add, string[] remove, string message)
    {
        var svc = NewSvc(out var seed);
        await SeedAsync(seed);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.SetAppsBulkAsync(new BulkPolygonAppsBulkRequest(ids.ToList(), add.ToList(), remove.ToList())));
        Assert.Contains(message, ex.Message);
    }

    [Fact]
    public void Normalise_TrimsUppercasesDedupesAndOrders()
    {
        Assert.Equal(new[] { "SCHEDULES", "ZONE_RATING", "PERIMETER" },
            PolygonApps.Normalise(["perimeter", " zone_rating", "SCHEDULES", "schedules", ""]));
    }
}
