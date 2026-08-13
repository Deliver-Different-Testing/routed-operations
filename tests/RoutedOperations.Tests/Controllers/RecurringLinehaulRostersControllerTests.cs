using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Controllers;

// Covers RecurringLinehaulRostersController: GET returns the roster grid,
// PUT rejects a malformed cell with 400 + explanatory message, DELETE
// distinguishes "row present" (Ok success envelope) from "not found" (404).
// Class-level [Authorize(RouteBuilder.Read)] and method-level Admin gate
// are declarative and not exercised here.
public class RecurringLinehaulRostersControllerTests
{
    private static (RecurringLinehaulRostersController ctl, DynamicDespatchDbContext seed) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var svc = new RecurringLinehaulService(ControllerTestHarness.Factory(opts));
        var controller = new RecurringLinehaulRostersController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, seed);
    }

    [Fact]
    public async Task GetGrid_EmptyStore_ReturnsWrappedGridWithNoRows()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetGrid());
        var grid = Assert.IsType<LinehaulRosterGridDto>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(grid.Rows);
    }

    [Fact]
    public async Task GetGrid_ForwardsWeekStartWithoutFailing()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetGrid("2026-01-05"));
        Assert.NotNull(ok.Value);
    }

    [Fact]
    public async Task Upsert_InvalidDayOfWeek_ReturnsBadRequestWithMessage()
    {
        var (ctl, _) = NewCtl();
        var dto = new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 1,
            DayOfWeek = 9, // invalid: valid range is 1..7
            TargetType = "Courier",
            TargetId = 5
        };
        var bad = Assert.IsType<BadRequestObjectResult>(await ctl.Upsert(dto));
        var body = bad.Value!;
        var msg = body.GetType().GetProperty("message")!.GetValue(body) as string;
        Assert.Contains("Invalid roster cell", msg);
    }

    [Fact]
    public async Task Upsert_MissingTargetType_ReturnsBadRequest()
    {
        var (ctl, _) = NewCtl();
        var dto = new LinehaulRosterUpsertDto
        {
            LinehaulRunId = 1,
            DayOfWeek = 2,
            TargetType = null, // Fixes 6: type required
            TargetId = 5
        };
        Assert.IsType<BadRequestObjectResult>(await ctl.Upsert(dto));
    }

    [Fact]
    public async Task Delete_MissingRosterId_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        Assert.IsType<NotFoundResult>(await ctl.Delete(999));
    }

    [Fact]
    public async Task Delete_ExistingRosterRow_ReturnsOkWithSuccessEnvelope()
    {
        var (ctl, seed) = NewCtl();
        seed.DispatchLinehaulRunRosters.Add(new DispatchLinehaulRunRoster
        {
            LinehaulRunRosterId = 1,
            LinehaulRunId = 1,
            CourierId = 1,
            DayOfWeek = 2,
            RosterDate = null,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        });
        await seed.SaveChangesAsync();

        var ok = Assert.IsType<OkObjectResult>(await ctl.Delete(1));
        var payload = ControllerTestHarness.ExtractResponse(ok)!;
        var success = payload.GetType().GetProperty("success")!.GetValue(payload);
        Assert.Equal(true, success);
    }
}
