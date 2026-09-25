using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Controllers;

// Covers RecurringLinehaulJobsController read + patch actions. Focus is on
// the response envelope shape ({ response = ... }) and the null -> 404
// mapping in GetDetail / UpdateSpeed. Auth is declarative (RouteBuilder.Read
// class-wide, Admin on PATCH).
public class RecurringLinehaulJobsControllerTests
{
    private static RecurringLinehaulJobsController NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var svc = new RecurringLinehaulJobsService(ControllerTestHarness.Factory(opts));
        var ctl = new RecurringLinehaulJobsController(svc);
        ControllerTestHarness.AttachHttpContext(ctl);
        return ctl;
    }

    [Fact]
    public async Task ListForRun_EmptyStore_ReturnsWrappedEmptyList()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.ListForRun(runId: 1));
        var list = Assert.IsAssignableFrom<IEnumerable<BulkJobListItemDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetDetail_MissingJob_ReturnsNotFound()
    {
        var ctl = NewCtl();
        Assert.IsType<NotFoundResult>(await ctl.GetDetail(jobId: 999));
    }

    [Fact]
    public async Task UpdateSpeed_MissingJob_ReturnsNotFound()
    {
        var ctl = NewCtl();
        var req = new BulkJobUpdateSpeedRequest { SpeedId = 3 };
        Assert.IsType<NotFoundResult>(await ctl.UpdateSpeed(jobId: 999, req));
    }

    [Fact]
    public async Task GetGroupedSpeeds_EmptyStore_ReturnsWrappedEmptyList()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetGroupedSpeeds());
        var list = Assert.IsAssignableFrom<IEnumerable<ReportingSpeedDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }
}
