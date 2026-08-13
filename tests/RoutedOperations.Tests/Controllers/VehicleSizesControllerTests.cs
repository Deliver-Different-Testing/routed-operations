// Covers VehicleSizesController: single GET wrapping VehicleSizeService.GetAllAsync
// in the standard `response = ...` envelope.
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Services.VehicleSize;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Controllers;

public class VehicleSizesControllerTests
{
    private static (VehicleSizesController controller, Core.Domain.DynamicDespatchDbContext seed) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var accessor = ControllerTestHarness.Accessor();
        var svc = new VehicleSizeService(ControllerTestHarness.Factory(opts),
            ControllerTestHarness.Cache(accessor));
        var controller = new VehicleSizesController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, seed);
    }

    [Fact]
    public async Task Get_NoSizes_ReturnsEmpty()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Get();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = (System.Collections.IEnumerable)ok.Value!.GetType()
            .GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Empty(list);
    }

    [Fact]
    public async Task Get_ReturnsOnlySizesWithCubicCapacity()
    {
        var (ctl, seed) = NewCtl();
        seed.VehicleSizes.AddRange(
            new VehicleSize { VehicleSizeId = 1, VehicleName = "Van", CubicCapacity = 5 },
            new VehicleSize { VehicleSizeId = 2, VehicleName = "Skip", CubicCapacity = null });
        await seed.SaveChangesAsync();

        var result = await ctl.Get();

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = (System.Collections.IEnumerable)ok.Value!.GetType()
            .GetProperty("response")!.GetValue(ok.Value)!;
        var count = 0; foreach (var _ in list) count++;
        Assert.Equal(1, count);
    }
}
