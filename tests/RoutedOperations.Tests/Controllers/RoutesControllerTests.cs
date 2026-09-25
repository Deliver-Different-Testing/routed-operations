// Covers RoutesController: five thin proxies to RouteOptimizationService +
// HereMapService. Tests use TestHttpMessageHandler (already used by the
// service tests) so no real HTTP fires; assertions target the envelope
// shape + null-body handling on the polyline route.
using System.Net;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Route;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Infrastructure;
using RoutedOperations.Tests.Services.Routing;

namespace RoutedOperations.Tests.Controllers;

public class RoutesControllerTests
{
    private static (RoutesController controller, TestHttpMessageHandler handler)
        NewCtl(string savvyId = "id-1", string hereKey = "key")
    {
        var handler = new TestHttpMessageHandler();
        var client = new HttpClient(handler);
        var settings = new AppSettings { RouteSavvyAppId = savvyId, HereMapsApiKey = hereKey };
        var opt = new RouteOptimizationService(client, settings);
        var here = new HereMapService(client, settings);
        var controller = new RoutesController(opt, here);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, handler);
    }

    // ── Optimize ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Optimize_SuccessReturnsEnvelopeWithRoutes()
    {
        var (ctl, handler) = NewCtl();
        handler.RespondJson(_ => true, """
        {"Message":"Success","OptimizedStops":[
          {"Name":"a","Index":0,"RouteLocation":{"Latitude":1.0,"Longitude":2.0}}]}
        """);

        var result = await ctl.Optimize(new List<SavvyLocationDto>
        {
            new() { Name = "a", Latitude = 1, Longitude = 2 },
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var routes = ok.Value!.GetType().GetProperty("routes")!.GetValue(ok.Value);
        Assert.NotNull(routes);
    }

    [Fact]
    public async Task Optimize_FailureReturnsEnvelopeWithEmptyRoutes()
    {
        var (ctl, handler) = NewCtl();
        handler.RespondJson(_ => true, """{"Message":"Failed","OptimizedStops":[]}""");

        var result = await ctl.Optimize(new List<SavvyLocationDto>());

        var ok = Assert.IsType<OkObjectResult>(result);
        var routes = (System.Collections.IEnumerable)ok.Value!.GetType()
            .GetProperty("routes")!.GetValue(ok.Value)!;
        Assert.Empty(routes);
    }

    // ── OptimizeWithName ─────────────────────────────────────────────────

    [Fact]
    public async Task OptimizeWithName_ReturnsRoutesEnvelope()
    {
        var (ctl, handler) = NewCtl();
        handler.RespondJson(_ => true, """
        {"Message":"Success","OptimizedStops":[
          {"Name":"a","Index":0,"RouteLocation":{"Latitude":1,"Longitude":2}}]}
        """);

        var result = await ctl.OptimizeWithName(new List<SavvyLocationDto>());

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(ok.Value!.GetType().GetProperty("routes"));
    }

    // ── HereSequence ─────────────────────────────────────────────────────

    [Fact]
    public async Task HereSequence_SurfacesResponseAsIs()
    {
        var (ctl, handler) = NewCtl();
        handler.RespondJson(_ => true, """{"results":[]}""");

        var result = await ctl.HereSequence(new HereMapSequenceRequest { RequestData = "&mode=car" });

        Assert.IsType<OkObjectResult>(result);
    }

    // ── HereSequenceTyped ────────────────────────────────────────────────

    [Fact]
    public async Task HereSequenceTyped_EmptyDestinationsReturnsSyntheticResult()
    {
        // With zero destinations HereMapService returns a synthetic result
        // without hitting the network; the controller wraps it Ok(result).
        var (ctl, _) = NewCtl();

        var result = await ctl.HereSequenceTyped(new HereSequenceRequestTyped
        {
            Start = new HereSequenceStop { Name = "S", Lat = 1, Lng = 2 },
            Destinations = new List<HereSequenceStop>(),
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = ok.Value as HereSequenceResult;
        Assert.NotNull(body);
        Assert.Equal(0d, body!.TotalMinutes);
    }

    // ── Polyline ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Polyline_LessThanTwoStops_ReturnsEmptyPoints()
    {
        // RoutePolylineAsync returns null when < 2 stops; the controller
        // maps null -> empty List<LatLngDto> so the client never crashes on
        // Points.length.
        var (ctl, _) = NewCtl();

        var result = await ctl.Polyline(new RoutePolylineRequest
        {
            Stops = new List<HereSequenceStop>(),
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<RoutePolylineResponse>(ok.Value);
        Assert.NotNull(body.Points);
        Assert.Empty(body.Points);
    }

    [Fact]
    public async Task Polyline_HereFailureReturnsEmptyPoints()
    {
        // Non-2xx HERE response -> RoutePolylineAsync returns null -> empty
        // list wrapper. Two stops = one chunk, one HTTP call.
        var (ctl, handler) = NewCtl();
        handler.Respond(_ => true, new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent(""),
        });

        var result = await ctl.Polyline(new RoutePolylineRequest
        {
            Stops = new List<HereSequenceStop>
            {
                new() { Name = "A", Lat = 1, Lng = 2 },
                new() { Name = "B", Lat = 3, Lng = 4 },
            },
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<RoutePolylineResponse>(ok.Value);
        Assert.Empty(body.Points);
    }
}
