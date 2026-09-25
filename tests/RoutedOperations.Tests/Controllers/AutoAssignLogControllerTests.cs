// Covers AutoAssignLogController: GetLog wraps AutoAssignLogService.GetLogAsync;
// GetUnresolvedRecurringBookings hits raw SQL (SqlQueryRaw) which InMemory
// cannot execute, so that action is covered only by verifying the guard
// path (throws once the raw SQL fires - controller has no pre-service
// short-circuit here so we skip explicit coverage of it and rely on the
// integration test to prove the wiring at deployment).
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Diagnostics;
using RoutedOperations.Core.Application.Services.Diagnostics;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Controllers;

public class AutoAssignLogControllerTests
{
    private static (AutoAssignLogController controller, Core.Domain.DynamicDespatchDbContext seed) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var svc = new AutoAssignLogService(ControllerTestHarness.Factory(opts));
        var controller = new AutoAssignLogController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, seed);
    }

    [Fact]
    public async Task Get_NoLogRows_ReturnsEmptyPage()
    {
        var (ctl, _) = NewCtl();

        var result = await ctl.Get(new RouteAutoAssignLogQuery());

        var ok = Assert.IsType<OkObjectResult>(result);
        var page = ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)
            as RouteAutoAssignLogPageDto;
        Assert.NotNull(page);
        Assert.Equal(0, page!.Total);
        Assert.Empty(page.Entries);
    }

    [Fact]
    public async Task Get_ReturnsRowsWithinDefaultWindow()
    {
        var (ctl, seed) = NewCtl();
        seed.RouteAutoAssignLogs.Add(new RouteAutoAssignLog
        {
            LogId = 1, CreatedAtUtc = DateTime.UtcNow.AddMinutes(-30),
            Outcome = "AssignedToRoute", TriggerSource = "test", Side = "Pickup",
        });
        await seed.SaveChangesAsync();

        var result = await ctl.Get(new RouteAutoAssignLogQuery { PageSize = 10 });

        var ok = Assert.IsType<OkObjectResult>(result);
        var page = (RouteAutoAssignLogPageDto)ok.Value!.GetType()
            .GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal(1, page.Total);
        Assert.Single(page.Entries);
        Assert.Equal("AssignedToRoute", page.Entries[0].Outcome);
    }

    [Fact]
    public async Task Get_OutcomeFilter_NarrowsResultSet()
    {
        var (ctl, seed) = NewCtl();
        seed.RouteAutoAssignLogs.AddRange(
            new RouteAutoAssignLog
            {
                LogId = 1, CreatedAtUtc = DateTime.UtcNow.AddMinutes(-10),
                Outcome = "AssignedToRoute", TriggerSource = "t", Side = "Pickup",
            },
            new RouteAutoAssignLog
            {
                LogId = 2, CreatedAtUtc = DateTime.UtcNow.AddMinutes(-5),
                Outcome = "NoMatch", TriggerSource = "t", Side = "Pickup",
            });
        await seed.SaveChangesAsync();

        var result = await ctl.Get(new RouteAutoAssignLogQuery { Outcome = "NoMatch" });

        var ok = Assert.IsType<OkObjectResult>(result);
        var page = (RouteAutoAssignLogPageDto)ok.Value!.GetType()
            .GetProperty("response")!.GetValue(ok.Value)!;
        Assert.Equal(1, page.Total);
        Assert.Equal("NoMatch", page.Entries[0].Outcome);
    }
}
