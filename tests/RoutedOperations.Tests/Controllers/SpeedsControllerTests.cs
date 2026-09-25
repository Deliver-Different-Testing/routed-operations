using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Speed;
using RoutedOperations.Core.Application.Services.Speed;

namespace RoutedOperations.Tests.Controllers;

// Covers SpeedsController: unwrapped Ok body (SpeedDto list) - this controller
// does NOT use the { response = ... } envelope, unlike its peers, because it
// pre-dates the standards convention (see 2026-07-16 handover). Both actions
// pass-through the SpeedService reply directly. Class-level RouteBuilder.Read.
public class SpeedsControllerTests
{
    private static SpeedsController NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var accessor = ControllerTestHarness.Accessor();
        var cache = ControllerTestHarness.Cache(accessor);
        var svc = new SpeedService(ControllerTestHarness.Factory(opts), cache);
        return new SpeedsController(svc);
    }

    [Fact]
    public async Task Get_ForDate_ReturnsOkDirectList()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.Get(new DateTime(2026, 1, 5)));
        var list = Assert.IsAssignableFrom<IEnumerable<SpeedDto>>(ok.Value!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetAll_ReturnsOkDirectList()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetAll());
        var list = Assert.IsAssignableFrom<IEnumerable<SpeedDto>>(ok.Value!);
        Assert.Empty(list);
    }
}
