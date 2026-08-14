// Covers RunViewerAssignmentController: 8 endpoints. Since the underlying
// RouteViewerAssignmentService uses INpScopeGuard (interface -> mockable)
// and ExecuteSqlRawAsync (blows up under InMemory), we focus on:
//   * Controller-level guards (empty JobIds, non-positive ids, blank codes)
//   * NpLabelScopeException -> 403 wrapping (guard substitute throws)
// Happy paths that hit SPs are covered by service tests + E2E.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerAssignmentControllerTests
{
    private static (RunViewerAssignmentController controller, INpScopeGuard guard, INpScopeResolver resolver)
        NewCtl(bool isAdmin = true, int? npAgentId = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var factory = ControllerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(isAdmin, npAgentId));
        var guard = Substitute.For<INpScopeGuard>();
        var svc = new RouteViewerAssignmentService(factory, resolver, guard,
            NullLogger<RouteViewerAssignmentService>.Instance);
        var controller = new RunViewerAssignmentController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, guard, resolver);
    }

    // ── GetAssignableTargets ─────────────────────────────────────────────

    [Fact]
    public async Task GetAssignableTargets_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl(isAdmin: false, npAgentId: 42);
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.GetAssignableTargets(1);

        var forbid = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, forbid.StatusCode);
    }

    // ── SearchCouriers ────────────────────────────────────────────────────

    [Fact]
    public async Task SearchCouriers_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl(isAdmin: false, npAgentId: 42);
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.SearchCouriers(1, "abc");

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── SearchAgents ─────────────────────────────────────────────────────

    [Fact]
    public async Task SearchAgents_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl(isAdmin: false, npAgentId: 42);
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.SearchAgents(1, "abc");

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── Assign ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Assign_EmptyJobIds_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.Assign(new BulkAssignRequest { JobIds = new List<int>() });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Assign_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl(isAdmin: false, npAgentId: 42);
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.Assign(new BulkAssignRequest
        {
            JobIds = new List<int> { 1 }, TargetType = "Courier", TargetId = 5,
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── Unassign ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Unassign_EmptyJobIds_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.Unassign(new BulkUnassignRequest { JobIds = new List<int>() });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Unassign_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl(isAdmin: false, npAgentId: 42);
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.Unassign(new BulkUnassignRequest
        {
            JobIds = new List<int> { 1 }, Target = "Courier",
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── PreAssignRun ─────────────────────────────────────────────────────

    [Fact]
    public async Task PreAssignRun_ZeroRunId_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.PreAssignRun(new PreAssignRunRequest
        {
            RunId = 0, ToCourierCode = "CX",
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task PreAssignRun_BlankToCourier_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.PreAssignRun(new PreAssignRunRequest
        {
            RunId = 1, ToCourierCode = "  ",
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ── TransferRun ──────────────────────────────────────────────────────

    [Fact]
    public async Task TransferRun_ZeroRunId_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.TransferRun(new TransferRunRequest
        {
            RunId = 0, ToCourierCode = "CX",
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task TransferRun_BlankToCourier_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.TransferRun(new TransferRunRequest
        {
            RunId = 1, ToCourierCode = "",
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ── ReleaseRun ───────────────────────────────────────────────────────

    [Fact]
    public async Task ReleaseRun_ZeroRunId_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.ReleaseRun(new ReleaseRunRequest
        {
            RunId = 0, CourierCode = "CX",
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task ReleaseRun_BlankCourier_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.ReleaseRun(new ReleaseRunRequest
        {
            RunId = 1, CourierCode = "",
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ── UnAssignRun ──────────────────────────────────────────────────────

    [Fact]
    public async Task UnAssignRun_ZeroRunId_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.UnAssignRun(new UnAssignRunRequest
        {
            RunId = 0, CourierCode = "CX",
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task UnAssignRun_BlankCourier_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.UnAssignRun(new UnAssignRunRequest
        {
            RunId = 1, CourierCode = "",
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ── TransferOriginalRunOrder ─────────────────────────────────────────

    [Fact]
    public async Task TransferOriginalRunOrder_ZeroRunId_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.TransferOriginalRunOrder(new TransferOriginalRunOrderRequest
        {
            RunId = 0, ToCourierCode = "CX",
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task TransferOriginalRunOrder_BlankToCourier_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.TransferOriginalRunOrder(new TransferOriginalRunOrderRequest
        {
            RunId = 1, ToCourierCode = "",
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }
}
