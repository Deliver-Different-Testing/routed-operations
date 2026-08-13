// Covers CouriersController: single GET wrapping CourierService.GetActiveAsync.
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Services.Courier;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Controllers;

public class CouriersControllerTests
{
    private static (CouriersController controller, Core.Domain.DynamicDespatchDbContext seed) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var accessor = ControllerTestHarness.Accessor();
        var svc = new CourierService(ControllerTestHarness.Factory(opts),
            ControllerTestHarness.Cache(accessor));
        var controller = new CouriersController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, seed);
    }

    [Fact]
    public async Task Get_NoCouriers_ReturnsEmpty()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Get();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = (System.Collections.IEnumerable)ok.Value!.GetType()
            .GetProperty("PotentialCouriers")!.GetValue(ok.Value)!;
        Assert.Empty(list);
    }

    [Fact]
    public async Task Get_SeededActiveCouriers_AreListed()
    {
        var (ctl, seed) = NewCtl();
        seed.TucCouriers.AddRange(
            new TucCourier { UccrId = 1, Code = "1", UccrName = "A", Active = true },
            new TucCourier { UccrId = 2, Code = "2", UccrName = "B", Active = false });
        await seed.SaveChangesAsync();

        var result = await ctl.Get();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = (System.Collections.IEnumerable)ok.Value!.GetType()
            .GetProperty("PotentialCouriers")!.GetValue(ok.Value)!;
        var count = 0; foreach (var _ in list) count++;
        Assert.Equal(1, count);
    }
}
