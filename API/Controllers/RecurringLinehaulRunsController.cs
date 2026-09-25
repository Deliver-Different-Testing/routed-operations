using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Recurring Routes Linehaul tab CRUD. Port of the Configurator
/// TenantLinehaulRunsController. Uses the standards Style-A response envelope
/// (<c>Ok(new { response = ... })</c>) and inherits the target-side
/// RouteBuilder.Read / RouteBuilder.Admin policy split (GETs are readable by
/// every tenant user; mutations require Admin).
/// </summary>
[ApiController]
[Route("api/recurring-linehaul-runs")]
[Authorize(Policy = "RouteBuilder.Read")]
public class RecurringLinehaulRunsController(RecurringLinehaulService service) : BaseController
{
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var list = await service.ListAsync();
        return Ok(new { response = list });
    }

    // Depot + courier dropdowns. "lookups" precedes {id:int} to avoid binding
    // it as an id parameter.
    [HttpGet("lookups")]
    public async Task<IActionResult> GetLookups()
    {
        var lookups = await service.GetLookupsAsync();
        return Ok(new { response = lookups });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var dto = await service.GetAsync(id);
        return dto is null ? NotFound() : Ok(new { response = dto });
    }

    [HttpPost]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Create([FromBody] RecurringLinehaulRunUpsertDto dto)
    {
        return Map(await service.CreateAsync(dto));
    }

    [HttpPut("{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] RecurringLinehaulRunUpsertDto dto)
    {
        return Map(await service.UpdateAsync(id, dto));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        return Map(await service.DeleteAsync(id));
    }

    // Schedules binding this run ("Used by Schedules" drill-down, Fix 7).
    [HttpGet("{id:int}/schedules")]
    public async Task<IActionResult> GetSchedules(int id)
    {
        var list = await service.GetScheduleBindingsAsync(id);
        return Ok(new { response = list });
    }

    // Candidate bookings to link as this run's master job.
    // Requires >= 2-char ?q= term (server-side guard).
    [HttpGet("{id:int}/linkable-bookings")]
    public async Task<IActionResult> GetLinkableBookings(int id, [FromQuery] string? q)
    {
        var list = await service.SearchLinkableBookingsAsync(id, q);
        return Ok(new { response = list });
    }

    [HttpPost("{id:int}/copy")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Copy(int id)
    {
        return Map(await service.CopyAsync(id));
    }

    private IActionResult Map(RecurringLinehaulMutationResult result)
    {
        if (result.NotFound) return NotFound();
        if (result.BlockedBySchedules)
        {
            return Conflict(new { message = "Remove this run from its active schedule(s) before deleting." });
        }
        if (result.ValidationError is not null)
        {
            return BadRequest(new { message = result.ValidationError });
        }
        return result.Dto is null
            ? Ok(new { response = new { success = true } })
            : Ok(new { response = result.Dto });
    }
}
