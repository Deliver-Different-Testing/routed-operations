using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Controllers;

// Covers RecurringLinehaulRunsController: read endpoints wrap the service's
// response in { response = ... }; mutation endpoints funnel through the
// private Map() helper which switches on RecurringLinehaulMutationResult to
// NotFound / Conflict / BadRequest / Ok. Auth policies (RouteBuilder.Read on
// the class + RouteBuilder.Admin on writes) are declarative and not exercised
// here - policy binding is covered by ASP.NET's own runtime.
public class RecurringLinehaulRunsControllerTests
{
    // ── Map() reflection tests (mirrors Configurator's TenantLinehaulRunsControllerTests) ─

    private static readonly MethodInfo MapM =
        typeof(RecurringLinehaulRunsController).GetMethod("Map",
            BindingFlags.NonPublic | BindingFlags.Instance)
        ?? throw new InvalidOperationException("Map() not found - signature changed?");

    private static IActionResult Map(RecurringLinehaulMutationResult result)
        => (IActionResult)MapM.Invoke(new RecurringLinehaulRunsController(null!), [result])!;

    [Fact]
    public void Map_NotFound_ReturnsNotFound()
        => Assert.IsType<NotFoundResult>(Map(new RecurringLinehaulMutationResult { NotFound = true }));

    [Fact]
    public void Map_BlockedBySchedules_ReturnsConflictWithMessage()
    {
        var conflict = Assert.IsType<ConflictObjectResult>(
            Map(new RecurringLinehaulMutationResult { BlockedBySchedules = true }));
        var body = conflict.Value!;
        var msg = body.GetType().GetProperty("message")!.GetValue(body) as string;
        Assert.Contains("Remove this run", msg);
    }

    [Fact]
    public void Map_ValidationError_ReturnsBadRequestWithMessage()
    {
        var bad = Assert.IsType<BadRequestObjectResult>(
            Map(new RecurringLinehaulMutationResult { ValidationError = "bad depot" }));
        var body = bad.Value!;
        var msg = body.GetType().GetProperty("message")!.GetValue(body) as string;
        Assert.Equal("bad depot", msg);
    }

    [Fact]
    public void Map_NoDto_ReturnsOkWithSuccessEnvelope()
    {
        var ok = Assert.IsType<OkObjectResult>(
            Map(new RecurringLinehaulMutationResult { Dto = null }));
        var payload = ControllerTestHarness.ExtractResponse(ok);
        Assert.NotNull(payload);
        var success = payload!.GetType().GetProperty("success")!.GetValue(payload);
        Assert.Equal(true, success);
    }

    [Fact]
    public void Map_WithDto_ReturnsOkWithDto()
    {
        var dto = new RecurringLinehaulRunDto { Id = 42, RunName = "AKL->WLG" };
        var ok = Assert.IsType<OkObjectResult>(Map(RecurringLinehaulMutationResult.Ok(dto)));
        var payload = ControllerTestHarness.ExtractResponse(ok);
        Assert.Same(dto, payload);
    }

    // ── Read endpoints via a real InMemory-backed service ─────────────────

    private static (RecurringLinehaulRunsController controller, DynamicDespatchDbContext seed) NewCtl()
    {
        var opts = ControllerTestHarness.NewOptions();
        var seed = ControllerTestHarness.Context(opts);
        var svc = new RecurringLinehaulService(ControllerTestHarness.Factory(opts));
        var controller = new RecurringLinehaulRunsController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return (controller, seed);
    }

    [Fact]
    public async Task GetAll_EmptyStore_ReturnsOkEmptyResponse()
    {
        var (ctl, _) = NewCtl();
        var result = await ctl.GetAll();
        var ok = Assert.IsType<OkObjectResult>(result);
        var list = Assert.IsAssignableFrom<IEnumerable<RecurringLinehaulRunDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetAll_ReturnsSeededRuns()
    {
        var (ctl, seed) = NewCtl();
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "AK", Active = true });
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 2, Name = "WN", Active = true });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 10, RunName = "AK->WN", FromDepotId = 1, ToDepotId = 2, Mode = 1
        });
        await seed.SaveChangesAsync();

        var ok = Assert.IsType<OkObjectResult>(await ctl.GetAll());
        var list = Assert.IsAssignableFrom<IEnumerable<RecurringLinehaulRunDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Single(list);
    }

    [Fact]
    public async Task GetLookups_ReturnsWrappedLookups()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetLookups());
        var lookups = Assert.IsType<RecurringLinehaulLookupsDto>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.NotNull(lookups.Depots);
        Assert.NotNull(lookups.Couriers);
    }

    [Fact]
    public async Task Get_MissingId_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        Assert.IsType<NotFoundResult>(await ctl.Get(999));
    }

    [Fact]
    public async Task Get_ExistingId_ReturnsOkDto()
    {
        var (ctl, seed) = NewCtl();
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "AK", Active = true });
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 2, Name = "WN", Active = true });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 5, RunName = "T", FromDepotId = 1, ToDepotId = 2, Mode = 1
        });
        await seed.SaveChangesAsync();

        var ok = Assert.IsType<OkObjectResult>(await ctl.Get(5));
        var dto = Assert.IsType<RecurringLinehaulRunDto>(ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Equal(5, dto.Id);
    }

    [Fact]
    public async Task GetSchedules_ReturnsWrappedList()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetSchedules(1));
        var list = Assert.IsAssignableFrom<IEnumerable<RecurringLinehaulScheduleBindingDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetLinkableBookings_ReturnsWrappedList()
    {
        var (ctl, _) = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetLinkableBookings(1, "abc"));
        var list = Assert.IsAssignableFrom<IEnumerable<RecurringLinehaulBookingLookupDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    // ── Mutation endpoints ────────────────────────────────────────────────

    [Fact]
    public async Task Create_MissingRunName_ReturnsBadRequestWithValidationMessage()
    {
        var (ctl, _) = NewCtl();
        var dto = new RecurringLinehaulRunUpsertDto { FromDepotId = 1, ToDepotId = 2 };
        var result = await ctl.Create(dto);
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Update_UnknownRun_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        var dto = new RecurringLinehaulRunUpsertDto
        {
            RunName = "X", FromDepotId = 1, ToDepotId = 2
        };
        Assert.IsType<NotFoundResult>(await ctl.Update(999, dto));
    }

    [Fact]
    public async Task Delete_UnknownRun_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        Assert.IsType<NotFoundResult>(await ctl.Delete(999));
    }

    [Fact]
    public async Task Copy_UnknownSource_ReturnsNotFound()
    {
        var (ctl, _) = NewCtl();
        Assert.IsType<NotFoundResult>(await ctl.Copy(999));
    }
}
