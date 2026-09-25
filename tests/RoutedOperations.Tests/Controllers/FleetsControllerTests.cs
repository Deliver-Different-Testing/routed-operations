// Covers FleetsController: single GET wrapping CourierService.GetActiveByFleetAsync.
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Services.Courier;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Controllers;

public class FleetsControllerTests
{
    private static (FleetsController controller, Core.Domain.DynamicDespatchDbContext seed) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var accessor = ControllerTestHarness.Accessor();
        var svc = new CourierService(ControllerTestHarness.Factory(opts),
            ControllerTestHarness.Cache(accessor));
        var controller = new FleetsController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, seed);
    }

    [Fact]
    public async Task Get_NoCouriers_ReturnsEmptyFleetsList()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Get();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = (System.Collections.IEnumerable)ok.Value!.GetType()
            .GetProperty("fleets")!.GetValue(ok.Value)!;
        Assert.Empty(list);
    }

    [Fact]
    public async Task Get_ActiveCouriersGroupedByFleet()
    {
        var (ctl, seed) = NewCtl();
        seed.TucCourierFleets.Add(new TucCourierFleet { UccfId = 1, UccfName = "Blue" });
        seed.TucCouriers.Add(new TucCourier
        {
            UccrId = 1, Code = "1", UccrName = "A", CourierFleetId = 1, Active = true,
        });
        await seed.SaveChangesAsync();

        var result = await ctl.Get();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = (System.Collections.IEnumerable)ok.Value!.GetType()
            .GetProperty("fleets")!.GetValue(ok.Value)!;
        var count = 0; foreach (var _ in list) count++;
        Assert.Equal(1, count);
    }
}
