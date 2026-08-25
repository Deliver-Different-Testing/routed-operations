using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.Schedule;
using RoutedOperations.Core.Application.Services.Schedule;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Schedule groups. A group is identified by Name (with an optional
/// LegacyClientId for pre-junction rows). Every endpoint operates on the
/// group as a whole; individual day-window rows are managed via the
/// group's DayWindows array on save.
/// </summary>
[ApiController]
[Route("api/schedules")]
[Authorize(Policy = "RouteBuilder.Read")]
public class SchedulesController(ScheduleService svc) : BaseController
{
    /// <summary>
    /// List schedule groups. Filter by client either by CODE (preferred -
    /// operators use ACME etc.) or by ID (kept for internal callers).
    /// Both null / empty = default view (client-agnostic groups).
    /// If both are set, clientCode wins.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] string clientCode = null,
        [FromQuery] int? clientId = null)
    {
        try
        {
            List<Core.Application.Dtos.Schedule.ScheduleGroupDto> list;
            if (!string.IsNullOrWhiteSpace(clientCode))
                list = await svc.GetByClientCodeAsync(clientCode);
            else
            {
                var normalized = clientId.HasValue && clientId.Value > 0 ? clientId : null;
                list = await svc.GetAsync(normalized);
            }
            return Ok(new { response = list });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet("lookups")]
    public async Task<IActionResult> GetLookups()
    {
        var lookups = await svc.GetLookupsAsync();
        return Ok(new { response = lookups });
    }

    /// <summary>
    /// Server-side client type-ahead. Substring LIKE on ucclCode OR
    /// ucclName among active clients only. Empty q returns the first
    /// `limit` clients alphabetically for a browse experience.
    /// Preferred over filtering the lookups.clients array in the
    /// browser because tenants have thousands of clients and the
    /// lookups payload is capped.
    /// </summary>
    [HttpGet("clients")]
    public async Task<IActionResult> SearchClients(
        [FromQuery] string q = null,
        [FromQuery] int limit = 50)
    {
        var list = await svc.SearchClientsAsync(q, limit);
        return Ok(new { response = list });
    }

    /// <summary>
    /// Upsert a schedule group. Name identifies the group; the request
    /// body carries every day-window + junction id-list needed to bring
    /// the group into its target state.
    /// </summary>
    [HttpPut]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Upsert([FromBody] ScheduleGroupUpsertRequest req)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        try
        {
            var saved = await svc.UpsertAsync(req);
            return Ok(new { response = saved });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// Delete a whole schedule group. legacyClientId is required for
    /// legacy per-client override groups (nullable = default group).
    /// </summary>
    [HttpDelete]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Delete([FromQuery] string name, [FromQuery] int? legacyClientId = null)
    {
        try
        {
            await svc.DeleteAsync(name, legacyClientId);
            return Ok(new { response = "Deleted" });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// Copy a schedule group - clone every day-window row + zones +
    /// linehauls + junction bindings under a new name. Client bindings
    /// on the copy default to the source's junction, or use the
    /// ClientCodes / ClientIds override in the body.
    /// </summary>
    [HttpPost("copy")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Copy([FromBody] ScheduleCopyRequest req)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        try
        {
            var copy = await svc.CopyAsync(req);
            return Ok(new { response = copy });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// Toggle AutoBook across every row in a schedule group. Returns
    /// the new value.
    /// </summary>
    [HttpPost("auto-book")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> ToggleAutoBook([FromQuery] string name, [FromQuery] int? legacyClientId = null)
    {
        try
        {
            var now = await svc.ToggleAutoBookAsync(name, legacyClientId);
            return Ok(new { response = new { autoBook = now } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
