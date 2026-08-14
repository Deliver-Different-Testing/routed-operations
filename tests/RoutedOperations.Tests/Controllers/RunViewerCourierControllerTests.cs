// Covers RunViewerCourierController: 5 endpoints. RouteViewerCourierService
// wraps 5 SPs that all short-circuit to empty for NP sessions (Section
// 3.4) before touching the DB, so we can drive that branch cleanly. SP
// branches under an admin scope blow up on InMemory. We focus on:
//   * Controller-level guards (blank courier code on the route endpoint)
//   * NP short-circuit path returns Ok with an empty envelope for the 4
//     endpoints that return lists / a null position for the 5th
//   * Admin path propagates the underlying provider exception (i.e.
//     controller does not swallow) for the couriers-by-runDate endpoint
// Happy paths that hit SPs are covered by service tests + E2E.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerCourierControllerTests
{
    private static RunViewerCourierController NewCtl(bool isAdmin = true, int? npAgentId = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var factory = ControllerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(isAdmin, npAgentId));
        var svc = new RouteViewerCourierService(factory, resolver,
            NullLogger<RouteViewerCourierService>.Instance);
        var controller = new RunViewerCourierController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return controller;
    }

    // -- GetCourierRoute: blank code guard ------------------------------

    [Fact]
    public async Task GetCourierRoute_BlankCode_ReturnsBadRequest()
    {
        var ctl = NewCtl();

        var result = await ctl.GetCourierRoute(code: "  ",
            start: DateTime.Today, end: DateTime.Today.AddHours(1));

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task GetCourierRoute_EmptyCode_ReturnsBadRequest()
    {
        var ctl = NewCtl();

        var result = await ctl.GetCourierRoute(code: "",
            start: DateTime.Today, end: DateTime.Today.AddHours(1));

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // -- NP short-circuit: empty envelopes on the list endpoints --------

    [Fact]
    public async Task GetActiveCouriers_Np_ReturnsOkEmptyEnvelope()
    {
        var ctl = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.GetActiveCouriers(runDate: DateTime.Today);

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ControllerTestHarness.ExtractResponse(ok);
        var rows = Assert.IsType<List<CourierListDto>>(payload);
        Assert.Empty(rows);
    }

    [Fact]
    public async Task SearchCouriers_Np_ReturnsOkEmptyEnvelope()
    {
        var ctl = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.SearchCouriers(q: "ABC");

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ControllerTestHarness.ExtractResponse(ok);
        var rows = Assert.IsType<List<CourierListDto>>(payload);
        Assert.Empty(rows);
    }

    [Fact]
    public async Task GetCourierPosition_Np_ReturnsOkNullEnvelope()
    {
        var ctl = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.GetCourierPosition(jobId: 1);

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ControllerTestHarness.ExtractResponse(ok);
        Assert.Null(payload);
    }

    [Fact]
    public async Task GetAvailableCouriers_Np_ReturnsOkEmptyEnvelope()
    {
        var ctl = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.GetAvailableCouriers(minLng: 1m, minLat: 2m, maxLng: 3m, maxLat: 4m);

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ControllerTestHarness.ExtractResponse(ok);
        var rows = Assert.IsType<List<AvailableCourierPositionDto>>(payload);
        Assert.Empty(rows);
    }

    [Fact]
    public async Task GetCourierRoute_Np_ReturnsOkEmptyEnvelope()
    {
        var ctl = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.GetCourierRoute(code: "ABC",
            start: DateTime.Today, end: DateTime.Today.AddHours(1));

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ControllerTestHarness.ExtractResponse(ok);
        var rows = Assert.IsType<List<CourierRoutePointDto>>(payload);
        Assert.Empty(rows);
    }

    // -- Admin path: SP-hitting branch propagates the provider error ----

    [Fact]
    public async Task GetActiveCouriers_Admin_PropagatesProviderException()
    {
        var ctl = NewCtl(isAdmin: true);

        await Assert.ThrowsAnyAsync<Exception>(() => ctl.GetActiveCouriers(runDate: DateTime.Today));
    }
}
