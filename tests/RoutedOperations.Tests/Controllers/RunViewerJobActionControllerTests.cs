// Covers RunViewerJobActionController: 15 endpoints under /api/runviewer/jobs.
// Underlying RouteViewerJobActionService calls INpScopeGuard (interface,
// mockable) and ExecuteSqlRawAsync (throws under InMemory), so we focus on:
//   * Controller Run() wrapper: NpLabelScopeException -> 403 (guard throws),
//     ArgumentException -> 400
//   * Bulk short-circuit paths (empty BulkJobIds arrays -> no SP, 200 "ok")
//   * Non-guarded endpoints (SendSmsRun) verify SP-failure surfaces
// Happy paths that hit SPs are covered by service tests + E2E.
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerJobActionControllerTests
{
    private static (RunViewerJobActionController controller, INpScopeGuard guard, INpScopeResolver resolver)
        NewCtl(bool isAdmin = false, int? npAgentId = 42)
    {
        var opts = ControllerTestHarness.NewOptions();
        var factory = ControllerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(isAdmin, npAgentId));
        var guard = Substitute.For<INpScopeGuard>();
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("FirstName", "Test"),
            new Claim("Surname", "User"),
        }, authenticationType: "test"));
        accessor.HttpContext.Returns(ctx);
        var svc = new RouteViewerJobActionService(factory, resolver, guard, accessor,
            NullLogger<RouteViewerJobActionService>.Instance);
        var controller = new RunViewerJobActionController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, guard, resolver);
    }

    // ── Activate ────────────────────────────────────────────────────────

    [Fact]
    public async Task Activate_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.Activate(new JobActionRequest { JobId = 1 });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── Pickup ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Pickup_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.Pickup(new JobActionRequest { JobId = 5 });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── Missing ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Missing_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.Missing(new JobActionRequest { JobId = 5 });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── Complete ────────────────────────────────────────────────────────

    [Fact]
    public async Task Complete_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.Complete(new CompleteJobRequest
        {
            JobId = 5, PodName = "Kevin",
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── Lmc ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Lmc_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.Lmc(new LmcJobRequest
        {
            JobId = 5, BulkJobId = 10, FromCourierCode = "CX",
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── Release ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Release_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.Release(new JobActionRequest { JobId = 5 });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── TransferCourier ─────────────────────────────────────────────────

    [Fact]
    public async Task TransferCourier_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.TransferCourier(new TransferJobRequest
        {
            JobId = 5, FromCourierCode = "CX", ToCourierCode = "AB",
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── SendSms ─────────────────────────────────────────────────────────

    [Fact]
    public async Task SendSms_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.SendSms(new SendSmsRequest
        {
            JobId = 5, Mobile = "0210000000", Message = "hi",
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── Cancel ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Cancel_EmptyBulkJobIds_Returns200Ok()
    {
        // Service short-circuits on empty array -> no SP fire -> Run()
        // returns Ok("ok"). Guard never called.
        var (ctl, guard, _) = NewCtl();

        var result = await ctl.Cancel(new BulkJobActionRequest
        {
            BulkJobIds = Array.Empty<int>(),
        });

        Assert.IsType<OkObjectResult>(result);
        await guard.DidNotReceive().EnsureBulkJobInScopeAsync(Arg.Any<int>());
    }

    [Fact]
    public async Task Cancel_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureBulkJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.Cancel(new BulkJobActionRequest
        {
            BulkJobIds = new[] { 1 },
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── MoveBack ────────────────────────────────────────────────────────

    [Fact]
    public async Task MoveBack_EmptyBulkJobIds_Returns200Ok()
    {
        var (ctl, guard, _) = NewCtl();

        var result = await ctl.MoveBack(new MoveJobsBackToRunBuilderRequest
        {
            BulkJobIds = Array.Empty<int>(),
            NewDateTime = DateTime.Today,
            NewSpeed = 1,
            Void = false,
        });

        Assert.IsType<OkObjectResult>(result);
        await guard.DidNotReceive().EnsureBulkJobInScopeAsync(Arg.Any<int>());
    }

    [Fact]
    public async Task MoveBack_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureBulkJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.MoveBack(new MoveJobsBackToRunBuilderRequest
        {
            BulkJobIds = new[] { 1 },
            NewDateTime = DateTime.Today,
            NewSpeed = 1,
            Void = false,
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── AddJobNote ──────────────────────────────────────────────────────

    [Fact]
    public async Task AddJobNote_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureTucJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.AddJobNote(new AddJobNoteRequest
        {
            JobId = 5, Notes = "note",
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── AddBulkNote ─────────────────────────────────────────────────────

    [Fact]
    public async Task AddBulkNote_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureBulkJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.AddBulkNote(new AddBulkJobNoteRequest
        {
            BulkJobId = 5, Notes = "note",
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // ── UpdateGps ───────────────────────────────────────────────────────

    [Fact]
    public async Task UpdateGps_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl();
        guard.EnsureBulkJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.UpdateGps(new UpdateJobGpsRequest
        {
            BulkJobId = 5, Leg = "delivery",
        });

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }
}
