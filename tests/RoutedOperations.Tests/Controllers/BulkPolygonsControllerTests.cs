using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.BulkPolygon;
using RoutedOperations.Core.Application.Services.BulkPolygon;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Controllers;

// Covers BulkPolygonsController: read paths return { response = ... };
// mutation paths are covered for model-state and unknown-id short-circuits
// only. The write flow itself uses SqlQueryRaw + geography::STGeomFromText
// which InMemory does not implement (SQLite would work but the SUT for those
// paths lives in BulkPolygonServiceTests). Auth policies are declarative.
public class BulkPolygonsControllerTests
{
    private static BulkPolygonsController NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var accessor = ControllerTestHarness.Accessor();
        var svc = new BulkPolygonService(ControllerTestHarness.Factory(opts), accessor);
        var ctl = new BulkPolygonsController(svc);
        ControllerTestHarness.AttachHttpContext(ctl);
        return ctl;
    }

    [Fact]
    public async Task GetAll_EmptyStore_ReturnsWrappedEmptyList()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetAll());
        var list = Assert.IsAssignableFrom<IEnumerable<BulkPolygonDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetOne_MissingPolygon_ReturnsNotFound()
    {
        var ctl = NewCtl();
        Assert.IsType<NotFoundResult>(await ctl.GetOne(999));
    }

    [Fact]
    public async Task Create_InvalidModelState_ReturnsBadRequest()
    {
        var ctl = NewCtl();
        ctl.ModelState.AddModelError("Name", "required");
        var req = new CreateBulkPolygonRequest("", 0, 0, new List<PolygonPointDto>());
        Assert.IsType<BadRequestObjectResult>(await ctl.Create(req));
    }

    [Fact]
    public async Task UpdateShape_InvalidModelState_ReturnsBadRequest()
    {
        var ctl = NewCtl();
        ctl.ModelState.AddModelError("Points", "required");
        var req = new UpdateBulkPolygonShapeRequest(0, 0, new List<PolygonPointDto>());
        Assert.IsType<BadRequestObjectResult>(await ctl.UpdateShape(1, req));
    }

    [Fact]
    public async Task UpdateMeta_InvalidModelState_ReturnsBadRequest()
    {
        var ctl = NewCtl();
        ctl.ModelState.AddModelError("Name", "required");
        var req = new UpdateBulkPolygonMetaRequest("");
        Assert.IsType<BadRequestObjectResult>(await ctl.UpdateMeta(1, req));
    }

    [Fact]
    public async Task UpdateMeta_UnknownPolygon_ReturnsNotFound()
    {
        // UpdateMetaAsync returns null for a missing / inactive polygon,
        // which the controller maps to NotFound. This path does not touch
        // any raw SQL, so InMemory is fine.
        var ctl = NewCtl();
        var req = new UpdateBulkPolygonMetaRequest("Rename");
        Assert.IsType<NotFoundResult>(await ctl.UpdateMeta(999, req));
    }

    [Fact]
    public async Task Delete_UnknownPolygon_ReturnsNotFound()
    {
        var ctl = NewCtl();
        Assert.IsType<NotFoundResult>(await ctl.Delete(999));
    }
}
