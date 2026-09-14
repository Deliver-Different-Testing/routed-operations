using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.Schedule;
using RoutedOperations.Core.Application.Services.Schedule;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// v2 read surface for the "Schedules NEW" page (Steve's 2026-09-08
/// KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT brief). Sits alongside the
/// legacy /api/schedules controller which powers the tuple-keyed
/// Schedules page. Both surfaces read the same tblBulkRunSchedule day
/// rows via the same ScheduleService; the difference is the semantic:
///
///   /api/schedules       - default view is "IsDefault only", tuple-keyed
///                          identity (Name + LegacyClientId), used by
///                          the legacy Schedules.tsx page.
///   /api/v2/schedules    - default view is "all live", id-keyed
///                          identity (ScheduleId only), used by the new
///                          SchedulesNew.tsx page with type + q filters
///                          per Steve's brief section 6.
///
/// Read-only until the BaseScheduleId column + tblBulkRunScheduleGroup
/// tables ship (Phase 4 of the workstream). Writes will land on this
/// controller alongside the migrations, keeping the legacy controller
/// untouched throughout.
/// </summary>
[ApiController]
[Route("api/v2/schedules")]
[Authorize(Policy = "RouteBuilder.Read")]
public class SchedulesV2Controller(ScheduleService svc) : BaseController
{
    /// <summary>
    /// List all live schedule headers. Filters:
    ///
    ///   type  = all | default | shared | override
    ///     - all      : every live header (default).
    ///     - default  : IsDefault = 1 only.
    ///     - shared   : IsDefault = 0 AND has >=1 link row.
    ///     - override : reserved. BaseScheduleId column has not shipped
    ///                  yet - always returns empty until the migration
    ///                  lands (Phase 4). Present in the enum so the
    ///                  frontend can select the filter and get an empty
    ///                  list rather than a schema error.
    ///
    ///   q     = substring match on Name (case-insensitive).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string type = "all",
        [FromQuery] string q = null,
        [FromQuery] int? clientId = null,
        [FromQuery] string clientIds = null)
    {
        try
        {
            // View-as-client resolution. `clientIds` (CSV of int) takes
            // precedence over the single `clientId` legacy param so the
            // multi-client picker on the Schedules NEW page can send
            // multiple ids at once; the backend UNIONs the per-client
            // resolution set (a schedule is bookable if it's bookable
            // for ANY of the selected clients). Empty selection = full
            // live set.
            var parsedIds = ParseClientIds(clientIds);
            List<ScheduleGroupSummaryDto> all;
            if (parsedIds.Count > 0)
            {
                var byId = new Dictionary<int, ScheduleGroupSummaryDto>();
                foreach (var id in parsedIds)
                {
                    var list = await svc.ListSummaryAsync(clientId: id);
                    foreach (var s in list)
                        byId.TryAdd(s.ScheduleId, s);
                }
                all = byId.Values.OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase).ToList();
            }
            else if (clientId.HasValue && clientId.Value > 0)
            {
                all = await svc.ListSummaryAsync(clientId: clientId.Value);
            }
            else
            {
                all = await svc.ListSummaryAsync(clientId: null, includeAllLive: true);
            }

            IEnumerable<ScheduleGroupSummaryDto> filtered = type?.ToLowerInvariant() switch
            {
                // Bases (headers with no BaseScheduleId) split into two
                // buckets: defaults (no clients bound) and shared
                // (clients bound via link table). Overrides are anything
                // with a BaseScheduleId set - populated as soon as
                // migration 20260914140000 applies. Pre-migration the
                // BaseScheduleId is always null so "override" returns
                // empty which is the correct behaviour.
                "default"  => all.Where(s => s.BaseScheduleId == null && s.LegacyClientId == null && s.ClientCount == 0),
                "shared"   => all.Where(s => s.BaseScheduleId == null && !(s.LegacyClientId == null && s.ClientCount == 0)),
                "override" => all.Where(s => s.BaseScheduleId != null),
                _          => all,
            };

            if (!string.IsNullOrWhiteSpace(q))
            {
                var needle = q.Trim();
                filtered = filtered.Where(s =>
                    s.Name != null &&
                    s.Name.Contains(needle, StringComparison.OrdinalIgnoreCase));
            }

            return Ok(new { response = filtered.ToList() });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    private static List<int> ParseClientIds(string csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return new List<int>();
        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => int.TryParse(s, out var v) ? v : 0)
            .Where(v => v > 0)
            .Distinct()
            .ToList();
    }

    /// <summary>
    /// Full detail for one schedule header. Used by the edit modal's
    /// Clients / Route / Operating days / Roster tabs. Read-only for
    /// Phase 1; the write endpoints land in Phase 3 (Steve's brief
    /// section 7 phases 4 and 5).
    ///
    /// Reuses ScheduleService.GetDetailAsync so this stays byte-for-byte
    /// identical with the legacy /api/schedules/detail response. When
    /// override support ships the DTO will grow BaseScheduleId + a
    /// derived overriddenFields list; consumers already reading via
    /// ScheduleId keep working.
    /// </summary>
    [HttpGet("{scheduleId:int}")]
    public async Task<IActionResult> GetOne(int scheduleId)
    {
        try
        {
            var detail = await svc.GetDetailAsync(scheduleId);
            return Ok(new { response = detail });
        }
        catch (InvalidOperationException ex)
        {
            return NotFound(new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/v2/schedules/{id}/overrides - lightweight list of the
    /// overrides pointing at this base + the client each owns. Used by
    /// the AttachClientsModal to render the "has own override #id"
    /// indicator so operators can see which candidate clients are
    /// unavailable to attach directly to the base.
    /// </summary>
    [HttpGet("{scheduleId:int}/overrides")]
    public async Task<IActionResult> ListOverrides(int scheduleId)
    {
        try
        {
            var list = await svc.ListOverridesAsync(scheduleId);
            return Ok(new { response = list });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // ─── Writes (Phase 3) ──────────────────────────────────────────

    /// <summary>
    /// POST /api/v2/schedules/{id}/clients - attach one or more clients
    /// to the schedule. Body `{ clientIds: int[] }`. Idempotent -
    /// already-attached client ids are silently skipped. Blocks
    /// attaching a client that has its own override of this base per
    /// Steve's section 5 invariant.
    /// </summary>
    [HttpPost("{scheduleId:int}/clients")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> AttachClients(int scheduleId, [FromBody] AttachClientsRequest req)
    {
        try
        {
            var added = await svc.AttachClientsAsync(scheduleId, req?.ClientIds ?? Array.Empty<int>());
            return Ok(new { response = new { added } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// DELETE /api/v2/schedules/{id}/clients/{clientId} - detach one
    /// client from the schedule.
    /// </summary>
    [HttpDelete("{scheduleId:int}/clients/{clientId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DetachClient(int scheduleId, int clientId)
    {
        try
        {
            var removed = await svc.DetachClientAsync(scheduleId, clientId);
            return Ok(new { response = new { removed } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/v2/schedules/{id}/overrides - create a client override
    /// of this base schedule. Body `{ clientId: int }`. Copies the
    /// base's day rows verbatim; the client's link row moves from base
    /// to override so the client is never on both.
    /// </summary>
    [HttpPost("{scheduleId:int}/overrides")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> CreateOverride(int scheduleId, [FromBody] CreateOverrideRequest req)
    {
        try
        {
            if (req == null || req.ClientId <= 0)
                return BadRequest(new { message = "clientId is required." });
            var newId = await svc.CreateOverrideAsync(scheduleId, req.ClientId);
            return Ok(new { response = new { scheduleId = newId } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/v2/schedules/{id}/retire - soft-delete the schedule
    /// header (sets RetiredUtc). Bookings + history preserved; live
    /// paths stop returning the schedule immediately. Wraps the
    /// existing ScheduleService.DeleteAsync retire path.
    /// </summary>
    [HttpPost("{scheduleId:int}/retire")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Retire(int scheduleId)
    {
        try
        {
            await svc.DeleteAsync(scheduleId);
            return Ok(new { response = "ok" });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/v2/schedule-groups - Dane's Schedule Groups bundles.
    /// Read-only for Phase 1; POST /PUT /DELETE + client-attach land
    /// in Phase 3. Returns empty until migration 20260914140000
    /// applies (Steve's brief section 5).
    /// </summary>
    [HttpGet("/api/v2/schedule-groups")]
    public async Task<IActionResult> ListGroups()
    {
        try
        {
            var list = await svc.ListScheduleGroupsAsync();
            return Ok(new { response = list });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}

public class AttachClientsRequest
{
    public int[] ClientIds { get; set; } = Array.Empty<int>();
}

public class CreateOverrideRequest
{
    public int ClientId { get; set; }
}
