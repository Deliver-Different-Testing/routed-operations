// Covers RunViewerRunController: 6 endpoints. RouteViewerRunService's
// non-short-circuit branches hit RVW_stpBulkRuns_2 + siblings via
// SqlQueryRaw (blows up under InMemory), so we focus on:
//   * The NP-degenerate short-circuit paths that never touch a SP
//     (each list endpoint returns empty; the controller wraps to Ok
//     with a response envelope)
//   * GetBulkRunJobs's runDate ArgumentException path -> BadRequest
//     (thrown by the service before any SP call)
//   * GetJobSiblings's jobId <= 0 short-circuit
// Happy paths that would hit the SPs are covered by service tests + E2E.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerRunControllerTests
{
    private static (RunViewerRunController controller, INpScopeResolver resolver)
        NewCtl(bool isAdmin = true, int? npAgentId = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var factory = ControllerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(isAdmin, npAgentId));
        var tz = new SqlTimeZoneNormalizer(factory);
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext());
        var svc = new RouteViewerRunService(factory, resolver, tz, accessor,
            NullLogger<RouteViewerRunService>.Instance);
        var controller = new RunViewerRunController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, resolver);
    }

    // GetBulkRunList

    [Fact]
    public async Task GetBulkRunList_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetBulkRunList(new BulkRunListRequest { RunDate = DateTime.Today });

        var ok = Assert.IsType<OkObjectResult>(result);
        var runs = Assert.IsAssignableFrom<IEnumerable<BulkRunDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(runs);
    }

    // GetBulkRunJobs

    [Fact]
    public async Task GetBulkRunJobs_MissingRunDate_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.GetBulkRunJobs(1, new BulkRunJobsRequest { RunDate = null });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task GetBulkRunJobs_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetBulkRunJobs(1,
            new BulkRunJobsRequest { RunDate = DateTime.Today });

        var ok = Assert.IsType<OkObjectResult>(result);
        var jobs = Assert.IsAssignableFrom<IEnumerable<BulkJobDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(jobs);
    }

    // GetLinehaulRunList

    [Fact]
    public async Task GetLinehaulRunList_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetLinehaulRunList(new LinehaulRunListRequest { RunDate = DateTime.Today });

        var ok = Assert.IsType<OkObjectResult>(result);
        var runs = Assert.IsAssignableFrom<IEnumerable<LinehaulRunDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(runs);
    }

    // GetRunRegionOverview

    [Fact]
    public async Task GetRunRegionOverview_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetRunRegionOverview(new RegionOverviewRequest { RunDate = DateTime.Today });

        var ok = Assert.IsType<OkObjectResult>(result);
        var rows = Assert.IsAssignableFrom<IEnumerable<RegionOverviewDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(rows);
    }

    // GetLinehaulRegionOverview

    [Fact]
    public async Task GetLinehaulRegionOverview_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetLinehaulRegionOverview(new RegionOverviewRequest { RunDate = DateTime.Today });

        var ok = Assert.IsType<OkObjectResult>(result);
        var rows = Assert.IsAssignableFrom<IEnumerable<RegionOverviewDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(rows);
    }

    // GetJobSiblings

    [Fact]
    public async Task GetJobSiblings_NpDegenerate_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetJobSiblings(1);

        var ok = Assert.IsType<OkObjectResult>(result);
        var siblings = Assert.IsAssignableFrom<IEnumerable<SiblingJobDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(siblings);
    }

    [Fact]
    public async Task GetJobSiblings_ZeroJobId_ReturnsOkEmpty()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.GetJobSiblings(0);

        var ok = Assert.IsType<OkObjectResult>(result);
        var siblings = Assert.IsAssignableFrom<IEnumerable<SiblingJobDto>>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(siblings);
    }
}
