// Covers RegionsController: single GET that ignores its `runDate` param
// (legacy SP parity) and returns active regions.
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Services.Region;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Controllers;

public class RegionsControllerTests
{
    private static (RegionsController controller, Core.Domain.DynamicDespatchDbContext seed) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var accessor = ControllerTestHarness.Accessor();
        var svc = new BulkRegionService(ControllerTestHarness.Factory(opts),
            ControllerTestHarness.Cache(accessor));
        var controller = new RegionsController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, seed);
    }

    [Fact]
    public async Task Get_NoRegions_ReturnsEmptyList()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Get(new DateTime(2026, 8, 13));

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Empty((System.Collections.IEnumerable)ok.Value!);
    }

    [Fact]
    public async Task Get_ReturnsOnlyActiveRegions()
    {
        var (ctl, seed) = NewCtl();
        seed.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 1, Name = "Active", Active = true },
            new TblBulkRegion { BulkRegionId = 2, Name = "Inactive", Active = false });
        await seed.SaveChangesAsync();

        var result = await ctl.Get(new DateTime(2026, 8, 13));

        var ok = Assert.IsType<OkObjectResult>(result);
        var list = (System.Collections.IEnumerable)ok.Value!;
        var count = 0; foreach (var _ in list) count++;
        Assert.Equal(1, count);
    }
}
