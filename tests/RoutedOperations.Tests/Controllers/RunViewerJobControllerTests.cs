// Covers RunViewerJobController: 13 endpoints. The underlying
// RouteViewerJobService uses INpScopeGuard (interface -> mockable) +
// INpScopeResolver + S3PhotoReader; SP-hitting branches use SqlQueryRaw
// (blows up under InMemory). Focus is on:
//   * Controller-level guards (blank query strings, empty file uploads,
//     blank keys / emails)
//   * NpLabelScopeException from the scope guard -> 403 wrapping
//   * NP-degenerate short-circuit branches that never touch a SP
// Happy paths that hit SPs are covered by service tests + E2E.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

[Collection("S3EnvVar")]
public class RunViewerJobControllerTests
{
    private static (RunViewerJobController controller, INpScopeGuard guard, INpScopeResolver resolver)
        NewCtl(bool isAdmin = true, int? npAgentId = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var factory = ControllerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(isAdmin, npAgentId));
        var guard = Substitute.For<INpScopeGuard>();
        var s3 = Substitute.For<Amazon.S3.IAmazonS3>();
        var reader = new S3PhotoReader(s3, NullLogger<S3PhotoReader>.Instance);
        var svc = new RouteViewerJobService(factory, resolver, guard, reader,
            NullLogger<RouteViewerJobService>.Instance);
        var controller = new RunViewerJobController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, guard, resolver);
    }

    // GetBulkJob

    [Fact]
    public async Task GetBulkJob_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl(isAdmin: false, npAgentId: 42);
        guard.EnsureBulkJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.GetBulkJob(1);

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // SearchByJobNumber

    [Fact]
    public async Task SearchByJobNumber_Blank_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.SearchByJobNumber("   ");

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task SearchByJobNumber_Empty_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.SearchByJobNumber("");

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // GetPrintJobList

    [Fact]
    public async Task GetPrintJobList_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetPrintJobList(new BulkRunListRequest { RunDate = DateTime.Today });

        var ok = Assert.IsType<OkObjectResult>(result);
        var jobs = Assert.IsAssignableFrom<IEnumerable<BulkJobDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(jobs);
    }

    // GetPrintJobChildren

    [Fact]
    public async Task GetPrintJobChildren_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl(isAdmin: false, npAgentId: 42);
        guard.EnsureBulkJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.GetPrintJobChildren(DateTime.Today, 1);

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // GetJobItems

    [Fact]
    public async Task GetJobItems_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl(isAdmin: false, npAgentId: 42);
        guard.EnsureBulkJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.GetJobItems(1, DateTime.Today);

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // GetClientIntel

    [Fact]
    public async Task GetClientIntel_BlankMobile_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.GetClientIntel("  ");

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // GetClientIntelImages

    [Fact]
    public async Task GetClientIntelImages_BlankMobile_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.GetClientIntelImages("");

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // GetBulkJobPhotos

    [Fact]
    public async Task GetBulkJobPhotos_NpGuardThrows_Returns403()
    {
        var (ctl, guard, _) = NewCtl(isAdmin: false, npAgentId: 42);
        guard.EnsureBulkJobInScopeAsync(Arg.Any<int>())
            .Returns(Task.FromException(new NpLabelScopeException("nope")));

        var result = await ctl.GetBulkJobPhotos(1);

        var r = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, r.StatusCode);
    }

    // UploadPodPhoto

    [Fact]
    public async Task UploadPodPhoto_NullFile_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.UploadPodPhoto(1, file: null!, isSignature: false, description: null, s3: null!);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // DeletePodPhoto

    [Fact]
    public async Task DeletePodPhoto_BlankKey_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.DeletePodPhoto(key: "  ", s3: null!);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // SendPod

    [Fact]
    public async Task SendPod_BlankToEmail_ReturnsBadRequest()
    {
        var (ctl, _, _) = NewCtl();

        var result = await ctl.SendPod(bulkJobId: 1, toEmail: "", labels: null!);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // GetLinehaulJobs

    [Fact]
    public async Task GetLinehaulJobs_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetLinehaulJobs(depotId: null, name: null,
            request: new BulkRunListRequest { RunDate = DateTime.Today });

        var ok = Assert.IsType<OkObjectResult>(result);
        var jobs = Assert.IsAssignableFrom<IEnumerable<BulkJobDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(jobs);
    }
}
