using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RecurringRoute;
using RoutedOperations.Core.Application.Services.RecurringRoute;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Controllers;

// Covers RecurringRoutesController: read paths wrap the service result in the
// { response = ... } envelope; not-found paths return NotFound; the
// SqlQueryRaw-backed centroid endpoint is exercised in the RecurringRouteService
// tests (SQLite-backed there) and skipped here because InMemory does not
// implement geography / SqlQueryRaw. Auth policies are declarative.
public class RecurringRoutesControllerTests
{
    private static (RecurringRoutesController ctl, DynamicDespatchDbContext seed) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var accessor = ControllerTestHarness.Accessor();
        var svc = new RecurringRouteService(ControllerTestHarness.Factory(opts), accessor);
        var ctl = new RecurringRoutesController(svc);
        ControllerTestHarness.AttachHttpContext(ctl);
        return (ctl, seed);
    }

    // ── GET routes ────────────────────────────────────────────────────────

    [Fact]
    public async Task GetAll_EmptyStore_ReturnsWrappedEmptyList()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetAll());
        var list = Assert.IsAssignableFrom<IEnumerable<RouteDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetOne_MissingRoute_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        Assert.IsType<NotFoundResult>(await ctl.GetOne(999));
    }

    // ── Create / Update / Copy / Delete ───────────────────────────────────

    [Fact]
    public async Task Create_InvalidModelState_ReturnsBadRequestFromHandler()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("Name", "required");
        var req = new UpsertRouteRequest("", "", 1, null, [], true, [], null);
        Assert.IsType<BadRequestObjectResult>(await ctl.Create(req));
    }

    [Fact]
    public async Task Update_UnknownRoute_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        var req = new UpsertRouteRequest("New", "A", 1, 1, [], true, [], null);
        Assert.IsType<NotFoundResult>(await ctl.Update(999, req));
    }

    [Fact]
    public async Task Update_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("Name", "required");
        var req = new UpsertRouteRequest("", "", 1, null, [], true, [], null);
        Assert.IsType<BadRequestObjectResult>(await ctl.Update(1, req));
    }

    [Fact]
    public async Task Copy_UnknownSource_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        var req = new CopyRouteRequest("Copied", 1, 1, null, false);
        Assert.IsType<NotFoundResult>(await ctl.Copy(999, req));
    }

    [Fact]
    public async Task Delete_UnknownRoute_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        Assert.IsType<NotFoundResult>(await ctl.Delete(999));
    }

    // ── Route roster ──────────────────────────────────────────────────────

    [Fact]
    public async Task GetBookings_ReturnsWrappedEmptyList()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetBookings(1));
        var list = Assert.IsAssignableFrom<IEnumerable<RouteBookingDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetMappedStops_ReturnsWrappedEmptyList()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetMappedStops(1));
        Assert.NotNull(ControllerTestHarness.ExtractResponse(ok));
    }

    [Fact]
    public async Task GetRoster_ReturnsWrappedEmptyList()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetRoster(1));
        var list = Assert.IsAssignableFrom<IEnumerable<RouteRosterEntryDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task AddRoster_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("TargetId", "required");
        var req = new UpsertRouteRosterRequest(1, 0, null, 1);
        Assert.IsType<BadRequestObjectResult>(await ctl.AddRoster(1, req));
    }

    [Fact]
    public async Task AddRoster_UnknownRoute_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        var req = new UpsertRouteRosterRequest(1, 5, null, 1);
        Assert.IsType<NotFoundResult>(await ctl.AddRoster(999, req));
    }

    [Fact]
    public async Task DeleteRoster_UnknownRoster_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        Assert.IsType<NotFoundResult>(await ctl.DeleteRoster(1, 999));
    }

    // ── Lookups ───────────────────────────────────────────────────────────

    [Fact]
    public async Task SearchZipcodes_EmptyQuery_ReturnsWrappedEmptyList()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.SearchZipcodes(""));
        var list = Assert.IsAssignableFrom<IEnumerable<ZipcodeLookupDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetPolygonShapes_EmptyIds_ReturnsWrappedEmptyList()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetPolygonShapes(new List<int>()));
        var list = Assert.IsAssignableFrom<IEnumerable<ZipPolygonShapeDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetPolygonShapes_NullIds_ReturnsWrappedEmptyList()
    {
        // The controller null-coalesces to an empty list before delegating.
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetPolygonShapes(null!));
        Assert.NotNull(ControllerTestHarness.ExtractResponse(ok));
    }

    [Fact]
    public async Task GetAssignableTargets_ReturnsWrappedResponse()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetAssignableTargets());
        var payload = Assert.IsType<AssignableTargetsResponse>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.NotNull(payload.Couriers);
        Assert.NotNull(payload.Agents);
        Assert.NotNull(payload.Nps);
    }

    [Fact]
    public async Task GetSchedulesLookup_ReturnsWrappedEmptyList()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetSchedulesLookup());
        var list = Assert.IsAssignableFrom<IEnumerable<ScheduleLookupDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }
}
