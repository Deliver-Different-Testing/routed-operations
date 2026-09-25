using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
    /// Translate an EF Core DbUpdateException into an operator-facing
    /// 400 message. Surfaces the SP-level constraint/FK error so the
    /// operator can see what actually failed rather than an opaque 500.
    /// </summary>
    private IActionResult HandleDbUpdate(DbUpdateException ex)
    {
        var inner = ex.InnerException?.Message ?? ex.Message;
        return BadRequest(new { message = "Save failed: " + inner });
    }
    /// <summary>
    /// List schedule groups. Filter by client either by CODE (preferred -
    /// operators use ACME etc.) or by ID (kept for internal callers).
    /// Both null / empty = default view (client-agnostic groups).
    /// If both are set, clientCode wins.
    ///
    /// `includeClientSpecific=true` widens the default view (clientCode +
    /// clientId both empty) to include groups with a client binding.
    /// Ignored when either client filter is set.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] string clientCode = null,
        [FromQuery] int? clientId = null,
        [FromQuery] bool includeClientSpecific = false)
    {
        try
        {
            List<Core.Application.Dtos.Schedule.ScheduleGroupSummaryDto> list;
            if (!string.IsNullOrWhiteSpace(clientCode))
                list = await svc.ListSummaryByClientCodeAsync(clientCode);
            else
            {
                var normalized = clientId.HasValue && clientId.Value > 0 ? clientId : null;
                list = await svc.ListSummaryAsync(normalized, includeClientSpecific);
            }
            return Ok(new { response = list });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// Full detail for one group. Preferred call: pass `scheduleId` (from
    /// ScheduleGroupDto.ScheduleId). Legacy tuple (`name`+`legacyClientId`)
    /// is retained for one release as a fallback so existing callers do
    /// not break; when both are supplied, `scheduleId` wins.
    /// </summary>
    [HttpGet("detail")]
    public async Task<IActionResult> GetDetail(
        [FromQuery] int? scheduleId = null,
        [FromQuery] string name = null,
        [FromQuery] int? legacyClientId = null)
    {
        try
        {
            ScheduleGroupDto group;
            if (scheduleId.HasValue && scheduleId.Value > 0)
                group = await svc.GetDetailAsync(scheduleId.Value);
            else if (!string.IsNullOrWhiteSpace(name))
                group = await svc.GetDetailAsync(name, legacyClientId);
            else
                return BadRequest(new { message = "scheduleId or name is required." });
            return Ok(new { response = group });
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
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// Soft-delete a whole schedule group (sets RetiredUtc on the header;
    /// day rows + link rows survive so history is preserved). Preferred
    /// call: `scheduleId`. Legacy tuple retained for one release.
    /// </summary>
    [HttpDelete]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Delete(
        [FromQuery] int? scheduleId = null,
        [FromQuery] string name = null,
        [FromQuery] int? legacyClientId = null)
    {
        try
        {
            if (scheduleId.HasValue && scheduleId.Value > 0)
                await svc.DeleteAsync(scheduleId.Value);
            else if (!string.IsNullOrWhiteSpace(name))
                await svc.DeleteAsync(name, legacyClientId);
            else
                return BadRequest(new { message = "scheduleId or name is required." });
            return Ok(new { response = "Deleted" });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
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
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// Toggle AutoBook across every row in a schedule group. Preferred:
    /// `scheduleId`. Legacy tuple retained for one release.
    /// </summary>
    [HttpPost("auto-book")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> ToggleAutoBook(
        [FromQuery] int? scheduleId = null,
        [FromQuery] string name = null,
        [FromQuery] int? legacyClientId = null)
    {
        try
        {
            bool now;
            if (scheduleId.HasValue && scheduleId.Value > 0)
                now = await svc.ToggleAutoBookAsync(scheduleId.Value);
            else if (!string.IsNullOrWhiteSpace(name))
                now = await svc.ToggleAutoBookAsync(name, legacyClientId);
            else
                return BadRequest(new { message = "scheduleId or name is required." });
            return Ok(new { response = new { autoBook = now } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }
}