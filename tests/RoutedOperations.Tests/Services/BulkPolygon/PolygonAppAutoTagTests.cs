using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.RecurringRoute;
using RoutedOperations.Core.Application.Dtos.Territory;
using RoutedOperations.Core.Application.Services.BulkPolygon;
using RoutedOperations.Core.Application.Services.RecurringRoute;
using RoutedOperations.Core.Application.Services.Territory;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkPolygon;

/// <summary>
/// Perimeter spec 4.5, product decision Q1: binding a polygon to an app's
/// object adds that app's tblBulkRunPolygonApp tag in the same save, once.
/// Covers every EF write path that creates a binding: ZoneName bind
/// (ZONE_RATING), zone group duplicate (SCHEDULES), route create / update
/// coverage (ROUTES), plus the Routes coverage search filter. AddToZoneAsync
/// runs a geography overlap query first, so it is covered against a real
/// SQL Server in <see cref="PolygonAppAutoTagSqlServerTests"/>.
/// </summary>
public class PolygonAppAutoTagTests
{
    private static BulkRunPolygon Poly(int id, string name, bool active = true) => new()
    {
        PolygonId = id, Name = name, Active = active, CreatedUtc = DateTime.UtcNow, CreatedBy = "s",
    };

    private static BulkRunPolygonApp App(int id, string code) => new()
    {
        PolygonId = id, AppCode = code, CreatedUtc = DateTime.UtcNow,
    };

    private static IHttpContextAccessor Accessor()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim("CountryCode", "NZ"), new Claim(ClaimTypes.Email, "kev@x"),
            ])),
        });
        return accessor;
    }

    private static async Task<List<(int Id, string App)>> TagsAsync(DbContextOptions<DespatchContext> opts)
    {
        await using var db = CockpitTestHarness.Context(opts);
        return (await db.BulkRunPolygonApps.AsNoTracking().ToListAsync())
            .Select(a => (a.PolygonId, a.AppCode))
            .OrderBy(t => t.PolygonId).ThenBy(t => t.AppCode)
            .ToList();
    }

    // ─── PolygonAppTags.EnsureAsync ───────────────────────────────────────

    [Fact]
    public async Task Ensure_adds_only_the_missing_tags_and_is_idempotent()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await using (var seed = CockpitTestHarness.Context(opts))
        {
            seed.BulkRunPolygons.AddRange(Poly(1, "A"), Poly(2, "B"), Poly(3, "C"));
            seed.BulkRunPolygonApps.AddRange(App(1, PolygonApps.Routes), App(2, PolygonApps.Schedules));
            await seed.SaveChangesAsync();
        }

        await using (var db = CockpitTestHarness.Context(opts))
        {
            // 1 already has ROUTES; 3 is listed twice; 2 has a different app.
            var added = await PolygonAppTags.EnsureAsync(db, [1, 2, 3, 3], PolygonApps.Routes);
            Assert.Equal(new[] { 2, 3 }, added);
            // A second call before the save sees the staged rows and adds nothing.
            Assert.Empty(await PolygonAppTags.EnsureAsync(db, [2, 3], PolygonApps.Routes));
            await db.SaveChangesAsync();
        }
        await using (var db = CockpitTestHarness.Context(opts))
        {
            Assert.Empty(await PolygonAppTags.EnsureAsync(db, [1, 2, 3], PolygonApps.Routes));
            await db.SaveChangesAsync();
        }

        Assert.Equal(
            new[] { (1, "ROUTES"), (2, "ROUTES"), (2, "SCHEDULES"), (3, "ROUTES") },
            await TagsAsync(opts));
    }

    [Fact]
    public async Task Ensure_refuses_an_unknown_app()
    {
        await using var db = CockpitTestHarness.Context(CockpitTestHarness.NewInMemoryOptions());
        await Assert.ThrowsAsync<ArgumentException>(() => PolygonAppTags.EnsureAsync(db, [1], "ROUTE"));
    }

    // ─── ZoneName bind -> ZONE_RATING ─────────────────────────────────────

    [Fact]
    public async Task BindZoneName_adds_ZoneRating_once_and_clearing_adds_nothing()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await using (var seed = CockpitTestHarness.Context(opts))
        {
            seed.BulkRunPolygons.AddRange(Poly(1, "Bound"), Poly(2, "Cleared"));
            seed.BulkRunPolygonApps.Add(App(1, PolygonApps.Schedules));
            await seed.SaveChangesAsync();
        }

        await new PolygonBindingService(CockpitTestHarness.Factory(opts)).BindZoneNameAsync(1, 7);
        await new PolygonBindingService(CockpitTestHarness.Factory(opts)).BindZoneNameAsync(1, 8);
        await new PolygonBindingService(CockpitTestHarness.Factory(opts)).BindZoneNameAsync(2, null);

        Assert.Equal(new[] { (1, "SCHEDULES"), (1, "ZONE_RATING") }, await TagsAsync(opts));
        await using var db = CockpitTestHarness.Context(opts);
        Assert.Equal(8, (await db.BulkRunPolygons.SingleAsync(p => p.PolygonId == 1)).ZoneNameId);
    }

    // ─── Zone group duplicate -> SCHEDULES ────────────────────────────────

    [Fact]
    public async Task DuplicateGroup_tags_the_copied_members_Schedules()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await using (var seed = CockpitTestHarness.Context(opts))
        {
            seed.BulkZonePostcodeGroups.Add(new BulkZonePostcodeGroup { Id = 1, Name = "BOP", DepotId = 4 });
            seed.BulkRunPolygons.AddRange(Poly(41, "Mount"), Poly(42, "Papamoa"));
            seed.BulkZonePolygons.AddRange(
                new BulkZonePolygon { Id = 1, PostcodeGroupId = 1, PolygonId = 41, Zone = 1, Active = true, CreatedBy = "s" },
                new BulkZonePolygon { Id = 2, PostcodeGroupId = 1, PolygonId = 42, Zone = 2, Active = true, CreatedBy = "s" });
            // 41 is already tagged (the backfill); 42 is an untagged legacy member.
            seed.BulkRunPolygonApps.Add(App(41, PolygonApps.Schedules));
            await seed.SaveChangesAsync();
        }

        var result = await new TerritoryService(CockpitTestHarness.Factory(opts), Accessor())
            .DuplicatePostcodeGroupAsync(1, new PostcodeGroupDuplicateRequest { Name = "BOP copy" });

        Assert.Equal(2, result.PolygonsCopied);
        Assert.Equal(new[] { (41, "SCHEDULES"), (42, "SCHEDULES") }, await TagsAsync(opts));
    }

    // ─── Route coverage -> ROUTES ─────────────────────────────────────────

    private static UpsertRouteRequest Route(List<int>? polygonIds) => new(
        Name: "Coverage route", Area: "AKL",
        DefaultTargetType: null, DefaultTargetId: null,
        ScheduleIds: [], Active: true, ZipPolygonIds: [], BulkPolygonIds: polygonIds);

    [Fact]
    public async Task RouteCreate_tags_attached_polygons_Routes_but_not_inactive_ones()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await using (var seed = CockpitTestHarness.Context(opts))
        {
            seed.BulkRunPolygons.AddRange(Poly(1, "Sched only"), Poly(2, "Already routes"), Poly(3, "Retired", active: false));
            seed.BulkRunPolygonApps.AddRange(App(1, PolygonApps.Schedules), App(2, PolygonApps.Routes));
            await seed.SaveChangesAsync();
        }
        var svc = new RecurringRouteService(CockpitTestHarness.Factory(opts), Accessor());

        var created = await svc.CreateAsync(Route([1, 2, 3]));

        Assert.Equal(new[] { 1, 2 }, created.BulkPolygons.Select(p => p.PolygonId).OrderBy(i => i));
        Assert.Equal(new[] { (1, "ROUTES"), (1, "SCHEDULES"), (2, "ROUTES") }, await TagsAsync(opts));
    }

    [Fact]
    public async Task RouteUpdate_tags_newly_attached_polygons_and_resaving_adds_no_duplicate()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await using (var seed = CockpitTestHarness.Context(opts))
        {
            seed.BulkRunPolygons.AddRange(Poly(1, "First"), Poly(2, "Second"));
            await seed.SaveChangesAsync();
        }
        var svc = new RecurringRouteService(CockpitTestHarness.Factory(opts), Accessor());
        var created = await svc.CreateAsync(Route([1]));

        await new RecurringRouteService(CockpitTestHarness.Factory(opts), Accessor())
            .UpdateAsync(created.RouteId, Route([1, 2]));
        await new RecurringRouteService(CockpitTestHarness.Factory(opts), Accessor())
            .UpdateAsync(created.RouteId, Route([1, 2]));
        // Null = leave the coverage alone: nothing attached, nothing tagged.
        await new RecurringRouteService(CockpitTestHarness.Factory(opts), Accessor())
            .UpdateAsync(created.RouteId, Route(null));

        Assert.Equal(new[] { (1, "ROUTES"), (2, "ROUTES") }, await TagsAsync(opts));
    }

    [Fact]
    public async Task SearchCoverage_lists_only_polygons_available_to_Routes()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        await using (var seed = CockpitTestHarness.Context(opts))
        {
            seed.BulkRunPolygons.AddRange(
                Poly(1, "Albany routes"), Poly(2, "Albany AD"), Poly(3, "Albany none"), Poly(4, "Albany both"));
            seed.BulkRunPolygonApps.AddRange(
                App(1, PolygonApps.Routes), App(2, PolygonApps.AutoDispatch),
                App(4, PolygonApps.Schedules), App(4, PolygonApps.Routes));
            await seed.SaveChangesAsync();
        }
        var svc = new RecurringRouteService(CockpitTestHarness.Factory(opts), Accessor());

        var hits = await svc.SearchCoverageAsync("Albany");

        Assert.Equal(new[] { 1, 4 }, hits.Where(h => h.Kind == "polygon").Select(h => h.Id).OrderBy(i => i));
    }
}
