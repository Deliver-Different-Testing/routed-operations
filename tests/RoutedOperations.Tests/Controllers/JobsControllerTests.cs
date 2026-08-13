// Covers JobsController: read paths (Get, filters, multibox children,
// detail extras) via a real InMemory-backed JobService; PATCH paths hit
// the same service. Void + BulkMove + SyncHd internally call raw SQL /
// SPs which InMemory cannot execute; tests there stick to the controller's
// pre-service short-circuits (ModelState invalid).
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Job;
using RoutedOperations.Core.Application.Services.Job;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Controllers;

public class JobsControllerTests
{
    private static (JobsController controller, Core.Domain.DynamicDespatchDbContext seed) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var factory = ControllerTestHarness.Factory(opts);
        var jobSvc = new JobService(factory);
        var voidSvc = new VoidJobService(factory);
        var cs = Substitute.For<IConnectionStringManager>();
        cs.GetConnectionStringAsync(Arg.Any<string>()).Returns(Task.FromResult<string?>(null));
        var accessor = ControllerTestHarness.Accessor();
        var hdSync = new HdJobSyncService(cs, accessor);
        var controller = new JobsController(jobSvc, voidSvc, hdSync);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, seed);
    }

    // ── Get ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_ReturnsEnvelopeWithBulkJobs()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Get(null, null, null, null, null);

        var ok = Assert.IsType<OkObjectResult>(result);
        var val = ok.Value!;
        var jobsProp = val.GetType().GetProperty("BulkJobs");
        Assert.NotNull(jobsProp);
        Assert.NotNull(jobsProp!.GetValue(val));
        var maxLen = val.GetType().GetProperty("MaxJsonLength");
        Assert.Equal(int.MaxValue, maxLen!.GetValue(val));
    }

    // ── GetClientFilters ──────────────────────────────────────────────────

    [Fact]
    public async Task GetClientFilters_ReturnsClientsInResponseEnvelope()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.GetClientFilters();

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
        var clients = response.GetType().GetProperty("clients");
        Assert.NotNull(clients);
    }

    // ── GetOurRefs ────────────────────────────────────────────────────────

    [Fact]
    public async Task GetOurRefs_NoJobs_ReturnsEmptyOurRefs()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.GetOurRefs(new DateTime(2026, 8, 13));

        var ok = Assert.IsType<OkObjectResult>(result);
        var refs = ok.Value!.GetType().GetProperty("OurRefs")!.GetValue(ok.Value);
        Assert.NotNull(refs);
        Assert.Empty((System.Collections.IEnumerable)refs!);
    }

    // ── GetMultiboxChildren ──────────────────────────────────────────────

    [Fact]
    public async Task GetMultiboxChildren_NoChildren_ReturnsEmpty()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.GetMultiboxChildren(999);

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value);
        Assert.Empty((System.Collections.IEnumerable)response!);
    }

    // ── GetDetail ─────────────────────────────────────────────────────────

    [Fact]
    public async Task GetDetail_UnknownJob_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.GetDetail(9999);

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task GetDetail_KnownJob_ReturnsExtras()
    {
        var (ctl, seed) = NewCtl();
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 100, JobNumber = "J100", ClientId = 1, ClientCode = "C",
            BookDate = DateTime.Today, BookTime = DateTime.Today, JobStatus = 0,
            Speed = 1, FromAddress = "F", ToAddress = "T",
        });
        await seed.SaveChangesAsync();

        var result = await ctl.GetDetail(100);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(ok.Value);
    }

    // ── UpdateDetail ──────────────────────────────────────────────────────

    [Fact]
    public async Task UpdateDetail_UnknownJob_ReturnsFailedString()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.UpdateDetail(999, new UpdateJobDetailRequest
        {
            Field = "notes", Value = "hi",
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value);
        Assert.Equal("Failed", response);
    }

    // ── UpdateGps ─────────────────────────────────────────────────────────

    [Fact]
    public async Task UpdateGps_UnknownJob_ReturnsFailedString()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.UpdateGps(999, new UpdateGpsRequest
        {
            Address = "Somewhere", Lat = "1", Lng = "2",
        });

        var ok = Assert.IsType<OkObjectResult>(result);
        var response = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value);
        Assert.Equal("Failed", response);
    }

    // ── BulkMove ──────────────────────────────────────────────────────────

    [Fact]
    public async Task BulkMove_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("JobIds", "required");

        var result = await ctl.BulkMove(new BulkUpdateRouteDateRequest());

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ── Void ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Void_InvalidModelState_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        ctl.ModelState.AddModelError("JobIds", "required");

        var result = await ctl.Void(new VoidJobsRequest());

        Assert.IsType<BadRequestObjectResult>(result);
    }
}
