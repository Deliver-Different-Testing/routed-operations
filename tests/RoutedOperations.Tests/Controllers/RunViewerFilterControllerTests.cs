// Covers RunViewerFilterController: 5 endpoints. RouteViewerFilterService
// wraps 4 lookup SPs (clients/speeds/regions/topup-services) via
// ExecuteSqlRaw (blows up under InMemory) plus one plain EF read for
// suburbs. Controller has no user-id inputs to guard, so we focus on:
//   * The suburbs EF-backed endpoint returns a well-shaped Ok envelope
//   * SP-backed endpoints propagate the underlying provider exception
//     when the service is invoked (i.e. controller does not swallow)
// Happy paths that hit SPs are covered by service tests + E2E.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerFilterControllerTests
{
    private static RunViewerFilterController NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var factory = ControllerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext());
        var svc = new RouteViewerFilterService(factory, resolver, accessor,
            NullLogger<RouteViewerFilterService>.Instance);
        var controller = new RunViewerFilterController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return controller;
    }

    // -- GetSuburbs (EF-backed, safe under InMemory) --------------------

    [Fact]
    public async Task GetSuburbs_EmptyDb_ReturnsOkWithEmptyResponseEnvelope()
    {
        var ctl = NewCtl();

        var result = await ctl.GetSuburbs();

        var ok = Assert.IsType<OkObjectResult>(result);
        var payload = ControllerTestHarness.ExtractResponse(ok);
        var rows = Assert.IsType<List<SuburbLookupDto>>(payload);
        Assert.Empty(rows);
    }

    // -- SP-backed endpoints: exception propagates through controller ---

    [Fact]
    public async Task GetClients_UnderInMemory_PropagatesProviderException()
    {
        var ctl = NewCtl();

        await Assert.ThrowsAnyAsync<Exception>(() =>
            ctl.GetClients(runDate: DateTime.Today, multipleClients: false, contactId: null));
    }

    [Fact]
    public async Task GetSpeeds_UnderInMemory_PropagatesProviderException()
    {
        var ctl = NewCtl();

        await Assert.ThrowsAnyAsync<Exception>(() => ctl.GetSpeeds(runDate: DateTime.Today));
    }

    [Fact]
    public async Task GetRegions_UnderInMemory_PropagatesProviderException()
    {
        var ctl = NewCtl();

        await Assert.ThrowsAnyAsync<Exception>(() => ctl.GetRegions(runDate: DateTime.Today));
    }

    [Fact]
    public async Task GetTopUpServices_UnderInMemory_PropagatesProviderException()
    {
        var ctl = NewCtl();

        await Assert.ThrowsAnyAsync<Exception>(() => ctl.GetTopUpServices());
    }
}
