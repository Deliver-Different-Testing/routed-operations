// Covers RunViewerScanController: 6 endpoints. RouteViewerScanService's
// admin branches hit RVW_stpScanJobs* via SqlQueryRaw (blows up under
// InMemory). Focus is on the NP short-circuit branches that never touch
// a SP:
//   * Bulk grid returns empty for any NP session (admin-only)
//   * Routed / detail / progress branches short-circuit for degenerate
//     NP (missing agent id)
//   * RemoveMissing returns false for NP scope -> controller Forbid()
// Happy paths that hit SPs are covered by service tests + E2E.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerScanControllerTests
{
    private static (RunViewerScanController controller, INpScopeResolver resolver)
        NewCtl(bool isAdmin = true, int? npAgentId = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var factory = ControllerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(isAdmin, npAgentId));
        var svc = new RouteViewerScanService(factory, resolver,
            NullLogger<RouteViewerScanService>.Instance);
        var controller = new RunViewerScanController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, resolver);
    }

    // GetBulkScanJobs

    [Fact]
    public async Task GetBulkScanJobs_Np_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.GetBulkScanJobs(new BulkRunListRequest { RunDate = DateTime.Today });

        var ok = Assert.IsType<OkObjectResult>(result);
        var rows = Assert.IsAssignableFrom<IEnumerable<BulkScanJobDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(rows);
    }

    // GetRoutedScanJobs

    [Fact]
    public async Task GetRoutedScanJobs_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetRoutedScanJobs(new BulkRunListRequest { RunDate = DateTime.Today });

        var ok = Assert.IsType<OkObjectResult>(result);
        var rows = Assert.IsAssignableFrom<IEnumerable<RoutedScanJobDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(rows);
    }

    // GetRoutedShipmentDetail

    [Fact]
    public async Task GetRoutedShipmentDetail_NpDegenerate_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetRoutedShipmentDetail(rootJobId: 1, runDate: DateTime.Today);

        Assert.IsType<NotFoundResult>(result);
    }

    // GetScanDetail

    [Fact]
    public async Task GetScanDetail_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetScanDetail(runDate: DateTime.Today, scan: "abc", rootJobId: 1);

        var ok = Assert.IsType<OkObjectResult>(result);
        var rows = Assert.IsAssignableFrom<IEnumerable<BulkScanDetailDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(rows);
    }

    // GetItemProgress

    [Fact]
    public async Task GetItemProgress_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetItemProgress(rootJobId: 1);

        var ok = Assert.IsType<OkObjectResult>(result);
        var rows = Assert.IsAssignableFrom<IEnumerable<RoutedItemProgressDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(rows);
    }

    // RemoveMissing

    [Fact]
    public async Task RemoveMissing_NpScope_ReturnsForbid()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.RemoveMissing(new RemoveMissingScanRequest { RunDate = DateTime.Today });

        Assert.IsType<ForbidResult>(result);
    }
}
