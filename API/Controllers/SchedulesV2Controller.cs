using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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
/// Write endpoints (POST/PUT/DELETE) added alongside the BaseScheduleId
/// migration (20260914140000). Legacy controller stays live for the old
/// Schedules.tsx page and remains untouched. Both surfaces write through
/// the same ScheduleService.UpsertAsync so the group-shape contract is
/// consistent across paths.
/// </summary>
[ApiController]
[Route("api/v2/schedules")]
[Authorize(Policy = "RouteBuilder.Read")]
public class SchedulesV2Controller(ScheduleService svc, ScheduleOverrideService overrides) : BaseController
{
    /// <summary>
    /// Translate an EF Core DbUpdateException into an operator-facing
    /// 400 message. The underlying SqlException usually names the FK or
    /// check constraint that failed - we surface that verbatim so the
    /// operator can act (e.g. "the client you picked was just deleted;
    /// refresh and try again") instead of an opaque 500.
    /// </summary>
    private IActionResult HandleDbUpdate(DbUpdateException ex)
    {
        var inner = ex.InnerException?.Message ?? ex.Message;
        return BadRequest(new { message = "Save failed: " + inner });
    }
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
        [FromQuery] string clientIds = null,
        [FromQuery] int page = 0,
        [FromQuery] int pageSize = 0)
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

            // Server-side pagination. `pageSize <= 0` means "return
            // everything" (back-compat with the pre-2026-09-15 shape:
            // the SchedulesTable will page client-side across the full
            // set). `pageSize > 0` triggers the paged shape which the
            // frontend now consumes so tenants with 10k+ schedules do
            // not fetch the whole list on every filter change.
            var full = filtered.ToList();
            var total = full.Count;
            var pageRows = pageSize <= 0
                ? full
                : full.Skip(Math.Max(0, page) * pageSize).Take(pageSize).ToList();
            return Ok(new { response = new
            {
                rows = pageRows,
                total,
                page = Math.Max(0, page),
                pageSize,
            }});
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
    /// GET /api/v2/schedules/{id}/overrides - every client's delta on
    /// this schedule. Grouped by client with three scope blocks
    /// (schedule / collection / delivery). Clients with no delta rows
    /// are excluded. Backed by tblBulkRunScheduleOverride from the
    /// 2026-09-22 delta migration; supersedes the clone-based
    /// BaseScheduleId model (Steve F1 2026-09-20).
    /// </summary>
    [HttpGet("{scheduleId:int}/overrides")]
    public async Task<IActionResult> ListOverrides(int scheduleId)
    {
        try
        {
            var list = await overrides.ListForScheduleAsync(scheduleId);
            return Ok(new { response = list });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/v2/clients/{clientId}/overrides - every schedule this
    /// client owns a delta on. Compact list feeding the client-first
    /// "you differ from N schedules" view.
    /// </summary>
    [HttpGet("~/api/v2/clients/{clientId:int}/overrides")]
    public async Task<IActionResult> ListClientOverrides(int clientId)
    {
        try
        {
            var list = await overrides.ListForClientAsync(clientId);
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
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
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
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// PUT /api/v2/schedules/{id}/overrides/{clientId} - full replace of
    /// this client's delta on this schedule. Every scope in the request
    /// wipes and re-writes its row (or deletes the row when the scope is
    /// null / wholly-null). An empty body deletes the client's override
    /// entirely (client returns to the base schedule). Steve F1
    /// 2026-09-20.
    /// </summary>
    [HttpPut("{scheduleId:int}/overrides/{clientId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> PutOverride(int scheduleId, int clientId, [FromBody] ScheduleOverridePutRequest req)
    {
        try
        {
            var payload = req ?? new ScheduleOverridePutRequest(null, null, null);
            var actor = User?.Identity?.Name ?? "RoutedOps";
            await overrides.PutAsync(scheduleId, clientId, payload, actor);
            var list = await overrides.ListForScheduleAsync(scheduleId);
            var entry = list.FirstOrDefault(o => o.ClientId == clientId);
            return Ok(new { response = entry });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// DELETE /api/v2/schedules/{id}/overrides/{clientId} - remove every
    /// delta row for this client on this schedule. The client returns to
    /// the base schedule in full. Steve F1 2026-09-20.
    /// </summary>
    [HttpDelete("{scheduleId:int}/overrides/{clientId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeleteOverride(int scheduleId, int clientId)
    {
        try
        {
            await overrides.DeleteAsync(scheduleId, clientId);
            return Ok(new { response = new { deleted = true } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// POST /api/v2/schedules - create a new schedule header + day rows
    /// + junctions in one shot. Body is the same ScheduleGroupUpsertRequest
    /// the legacy PUT accepts, with `scheduleId = null`. Returns the fresh
    /// ScheduleGroupDto (including its new scheduleId) so the caller can
    /// open it in the detail modal without a round-trip.
    /// </summary>
    [HttpPost]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Create([FromBody] ScheduleGroupUpsertRequest req)
    {
        if (req == null) return BadRequest(new { message = "Body is required." });
        req.ScheduleId = null;
        try
        {
            var saved = await svc.UpsertAsync(req);
            return Ok(new { response = saved });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// PUT /api/v2/schedules/{id} - update an existing schedule header +
    /// day rows + junctions. Path scheduleId wins; body's scheduleId (if
    /// any) is overridden.
    /// </summary>
    [HttpPut("{scheduleId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Update(int scheduleId, [FromBody] ScheduleGroupUpsertRequest req)
    {
        if (req == null) return BadRequest(new { message = "Body is required." });
        if (scheduleId <= 0) return BadRequest(new { message = "scheduleId is required." });
        req.ScheduleId = scheduleId;
        try
        {
            var saved = await svc.UpsertAsync(req);
            return Ok(new { response = saved });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// PUT /api/v2/schedules/{id}/clients - full replace of the schedule's
    /// link rows in one call. Body `{ clientIds: int[] }`. Adds missing,
    /// removes any not in the list; blocks any client that has its own
    /// override of this base per Steve's section 5 invariant.
    /// </summary>
    [HttpPut("{scheduleId:int}/clients")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> ReplaceClients(int scheduleId, [FromBody] AttachClientsRequest req)
    {
        try
        {
            var (added, removed) = await svc.ReplaceClientsAsync(scheduleId, req?.ClientIds ?? Array.Empty<int>());
            return Ok(new { response = new { added, removed } });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
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
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// POST /api/v2/schedules/{id}/is-active - flip the header's IsActive
    /// flag. Body `{ isActive: bool }`. Independent of AutoBook (which
    /// controls book-immediately vs stage); IsActive gates whether the
    /// schedule can be booked at all (Steve F21 2026-09-22).
    /// </summary>
    [HttpPost("{scheduleId:int}/is-active")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> SetIsActive(int scheduleId, [FromBody] SetIsActiveRequest req)
    {
        if (req == null) return BadRequest(new { message = "Body is required." });
        try
        {
            var next = await svc.ToggleIsActiveAsync(scheduleId, req.IsActive);
            return Ok(new { response = new { isActive = next } });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// POST /api/v2/schedules/{id}/copy - clone a schedule under a new
    /// name. Body `{ newName, clientIds? }`. Wraps
    /// ScheduleService.CopyAsync. Copy carries the source's day rows +
    /// zones + polygons; client link rows are set to `clientIds` (or
    /// empty for a "default" copy).
    /// </summary>
    [HttpPost("{scheduleId:int}/copy")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Copy(int scheduleId, [FromBody] CopyScheduleRequest req)
    {
        try
        {
            if (req == null || string.IsNullOrWhiteSpace(req.NewName))
                return BadRequest(new { message = "newName is required." });
            var group = await svc.CopyAsync(new ScheduleCopyRequest
            {
                SourceScheduleId = scheduleId,
                NewName = req.NewName,
                ClientCodes = new List<string>(),   // link-row semantics: copy uses ClientIds directly.
                ClientIds = (req.ClientIds ?? Array.Empty<int>()).ToList(),
            });
            return Ok(new { response = new { scheduleId = group.ScheduleId } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// GET /api/v2/schedule-bundles - Dane's Schedule Bundles.
    /// Read-only for Phase 1; POST /PUT /DELETE + client-attach land
    /// in Phase 3. Returns empty until migration 20260914140000
    /// applies (Steve's brief section 5). Renamed 2026-09-22 by
    /// Steve F18 - was /api/v2/schedule-groups.
    /// </summary>
    [HttpGet("/api/v2/schedule-bundles")]
    public async Task<IActionResult> ListBundles()
    {
        try
        {
            var list = await svc.ListScheduleBundlesAsync();
            return Ok(new { response = list });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/v2/schedule-bundles - create a Schedule Bundle with an
    /// initial member list. Body `{ name, description, scheduleIds[] }`.
    /// Returns the new bundleId.
    /// </summary>
    [HttpPost("/api/v2/schedule-bundles")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> CreateBundle([FromBody] CreateBundleRequest req)
    {
        try
        {
            if (req == null) return BadRequest(new { message = "Body is required." });
            var id = await svc.CreateBundleAsync(req.Name, req.Description, req.ScheduleIds ?? Array.Empty<int>());
            return Ok(new { response = new { bundleId = id } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>PUT /api/v2/schedule-bundles/{bundleId} - rename / redescribe.</summary>
    [HttpPut("/api/v2/schedule-bundles/{bundleId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpdateBundle(int bundleId, [FromBody] CreateBundleRequest req)
    {
        try
        {
            if (req == null) return BadRequest(new { message = "Body is required." });
            await svc.UpdateBundleAsync(bundleId, req.Name, req.Description);
            return Ok(new { response = "ok" });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// GET /api/v2/clients/{clientId}/schedules - the resolution rule
    /// made visible per Steve's brief §5. Returns one row per schedule
    /// the client can actually book, tagged with why ("override" |
    /// "shared" | "default"). Feeds the "View as client" chip strip on
    /// the Schedules NEW tab.
    /// </summary>
    [HttpGet("/api/v2/clients/{clientId:int}/schedules")]
    public async Task<IActionResult> ClientSchedules(int clientId)
    {
        try
        {
            var rows = await svc.GetSchedulesForClientAsync(clientId);
            return Ok(new { response = rows });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/v2/schedule-bundles/{bundleId}/members - add schedules
    /// to a bundle. Body `{ scheduleIds: int[] }`. Idempotent.
    /// </summary>
    [HttpPost("/api/v2/schedule-bundles/{bundleId:int}/members")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> AddBundleMembers(int bundleId, [FromBody] AddBundleMembersRequest req)
    {
        try
        {
            var added = await svc.AddBundleMembersAsync(bundleId, req?.ScheduleIds ?? Array.Empty<int>());
            return Ok(new { response = new { added } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>DELETE /api/v2/schedule-bundles/{bundleId}/members/{scheduleId}.</summary>
    [HttpDelete("/api/v2/schedule-bundles/{bundleId:int}/members/{scheduleId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> RemoveBundleMember(int bundleId, int scheduleId)
    {
        try
        {
            var removed = await svc.RemoveBundleMemberAsync(bundleId, scheduleId);
            return Ok(new { response = new { removed } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>DELETE /api/v2/schedule-bundles/{bundleId} - hard-delete.</summary>
    [HttpDelete("/api/v2/schedule-bundles/{bundleId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeleteBundle(int bundleId)
    {
        try
        {
            await svc.DeleteBundleAsync(bundleId);
            return Ok(new { response = "ok" });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }

    /// <summary>
    /// POST /api/v2/schedule-bundles/{bundleId}/clients - attach clients
    /// to every non-default member schedule of the bundle. Body
    /// `{ clientIds: int[] }`. Idempotent (already-attached pairs
    /// skipped). Returns the total number of link rows added.
    /// </summary>
    [HttpPost("/api/v2/schedule-bundles/{bundleId:int}/clients")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> AttachClientsToBundle(int bundleId, [FromBody] AttachClientsRequest req)
    {
        try
        {
            var added = await svc.AttachClientsToBundleAsync(bundleId, req?.ClientIds ?? Array.Empty<int>());
            return Ok(new { response = new { added } });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (DbUpdateException ex) { return HandleDbUpdate(ex); }
    }
}

public class AttachClientsRequest
{
    public int[] ClientIds { get; set; } = Array.Empty<int>();
}

public class CreateBundleRequest
{
    public string Name { get; set; }
    public string Description { get; set; }
    public int[] ScheduleIds { get; set; } = Array.Empty<int>();
}

public class AddBundleMembersRequest
{
    public int[] ScheduleIds { get; set; } = Array.Empty<int>();
}

public class CopyScheduleRequest
{
    public string NewName { get; set; }
    public int[] ClientIds { get; set; } = Array.Empty<int>();
}

public class SetIsActiveRequest
{
    public bool IsActive { get; set; }
}