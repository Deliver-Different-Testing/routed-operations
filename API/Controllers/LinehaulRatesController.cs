using DeliverDifferent.AccessControl.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.Linehaul;
using RoutedOperations.Core.Application.Services.Linehaul;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Prices for linehaul runs: the Linehaul tab in Schedules NEW (spec 12.2).
/// Separate from Territory because a run is a depot-to-depot leg and has no
/// zone group, which is the reason it became its own tab.
/// </summary>
[ApiController]
[Route("api/linehaul-rates")]
[Authorize(Policy = "RouteBuilder.Read")]
[RequireFeature("ro-schedules")]
public class LinehaulRatesController(LinehaulRateService svc) : BaseController
{
    /// <summary>Depot pairs that carry a run, plus the speeds that can become
    /// a column.</summary>
    [HttpGet("bootstrap")]
    public async Task<IActionResult> GetBootstrap() =>
        await Wrap(() => svc.GetBootstrapAsync());

    /// <summary>Runs with their run-level prices. clientId omitted means the
    /// default sheet.</summary>
    [HttpGet]
    public async Task<IActionResult> GetRuns(
        [FromQuery] int? fromDepotId = null,
        [FromQuery] int? toDepotId = null,
        [FromQuery] int? clientId = null) =>
        await Wrap(() => svc.GetRunsAsync(fromDepotId, toDepotId, clientId));

    /// <summary>Every schedule's own price on one run.</summary>
    [HttpGet("runs/{runId:int}/schedules")]
    public async Task<IActionResult> GetScheduleRates(
        int runId, [FromQuery] int? clientId = null) =>
        await Wrap(() => svc.GetScheduleRatesAsync(runId, clientId));

    /// <summary>Set one price. Sending neither figure clears it.</summary>
    [HttpPut]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Upsert([FromBody] LinehaulRateUpsertRequest req) =>
        await Wrap(() => svc.UpsertAsync(req));

    /// <summary>Add a priced speed column to a run, seeded from its any-speed
    /// price.</summary>
    [HttpPost("runs/{runId:int}/speeds/{speedId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> AddSpeedColumn(
        int runId, int speedId, [FromQuery] int? clientId = null) =>
        await Wrap(() => svc.AddSpeedColumnAsync(runId, speedId, clientId));

    // ─── HELPERS ───────────────────────────────────────────────────────────
    // Same shape as TerritoryController.Wrap: the service throws
    // InvalidOperationException with wording meant for the operator, and it
    // reaches the toast because api.ts prefers a server message over "HTTP
    // 400 at ...".

    private async Task<IActionResult> Wrap<T>(Func<Task<T>> op)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        try
        {
            var result = await op();
            return Ok(new { response = result });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
