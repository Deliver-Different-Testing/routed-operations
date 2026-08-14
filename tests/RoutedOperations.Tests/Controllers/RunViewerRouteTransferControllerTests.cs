// Covers RunViewerRouteTransferController: 3 endpoints under /api/runviewer/*.
// RouteViewerRouteTransferService uses INpScopeGuard (mockable) for the
// anchor-job scope check; TransferAsync's SP round-trip (SqlQueryRaw)
// throws under InMemory. Focus:
//   * Controller-level guard on Transfer (empty JobIds / zero NewRouteId
//     -> BadRequest, before the service is called)
//   * NpLabelScopeException -> 403 wrapping on GetTransferContext,
//     GetTransferPreview, Transfer
// Happy paths that hit SPs are covered by service tests + E2E.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerRouteTransferControllerTests
{
    private static (RunViewerRouteTransferController controller, INpScopeGuard guard)
        NewCtl(bool isAdmin = false, int? npAgentId = 42)
    {
        var opts = ControllerTestHarness.NewOptions();
        var factory = ControllerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(isAdmin, npAgentId));
        var guard = Substitute.For<INpScopeGuard>();
        var svc = new RouteViewerRouteTransferService(factory, resolver, guard,
            NullLogger<RouteViewerRouteTransferService>.Instance);
        var controller = new RunViewerRouteTransferController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, guard);
    }

    // ── GetTransferContext ──────────────────────────────────────────────

    [Fact]
    public async Task GetTransferContext_NpGuardThrows_Returns403()
    {
        var (ctl, guard) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.GetTransferContext(anchorJobId: 1);

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── GetTransferPreview ──────────────────────────────────────────────

    [Fact]
    public async Task GetTransferPreview_NpGuardThrows_Returns403()
    {
        var (ctl, guard) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.GetTransferPreview(ids: "1,2,3");

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── Transfer ────────────────────────────────────────────────────────

    [Fact]
    public async Task Transfer_EmptyJobIds_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Transfer(new TransferRouteRequest
        {
            JobIds = new List<int>(),
            NewRouteId = 5,
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Transfer_ZeroNewRouteId_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Transfer(new TransferRouteRequest
        {
            JobIds = new List<int> { 1 },
            NewRouteId = 0,
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Transfer_NpGuardThrows_Returns403()
    {
        var (ctl, guard) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.Transfer(new TransferRouteRequest
        {
            JobIds = new List<int> { 1 },
            NewRouteId = 5,
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }
}
