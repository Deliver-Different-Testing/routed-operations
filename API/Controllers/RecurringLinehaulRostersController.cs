using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Recurring Routes Linehaul Roster tab CRUD - the Run x Day driver grid
/// (spec 4). Polymorphic target (Courier/Agent/NP) per Fixes 6. The run's
/// own default driver (tblbulkLinehaulRun.CourierId) is never mutated here.
/// </summary>
[ApiController]
[Route("api/recurring-linehaul-rosters")]
[Authorize(Policy = "RouteBuilder.Read")]
public class RecurringLinehaulRostersController(RecurringLinehaulService service) : BaseController
{
    // weekStart accepted for forward-compat with v1.1 date overrides; v1
    // returns the recurring weekly grid regardless.
    [HttpGet]
    public async Task<IActionResult> GetGrid([FromQuery] string? weekStart = null)
    {
        _ = weekStart;
        var grid = await service.GetRosterGridAsync();
        return Ok(new { response = grid });
    }

    [HttpPut]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Upsert([FromBody] LinehaulRosterUpsertDto dto)
    {
        var cell = await service.UpsertRosterCellAsync(dto);
        return cell is null
            ? BadRequest(new { message = "Invalid roster cell (run, day-of-week 1-7, and a Courier/Agent/NP target are required)." })
            : Ok(new { response = cell });
    }

    [HttpDelete("{rosterId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Delete(int rosterId)
    {
        var ok = await service.DeleteRosterCellAsync(rosterId);
        return ok ? Ok(new { response = new { success = true } }) : NotFound();
    }
}
