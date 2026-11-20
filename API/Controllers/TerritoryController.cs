using Microsoft.AspNetCore.Authorization;
using DeliverDifferent.AccessControl.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Territory;
using RoutedOperations.Core.Application.Services.Territory;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Territory maintenance surface: depots, postcode groups, and the
/// tenant-switched zone data (NZ = BulkZonePostcode, US = ZoneZip /
/// ZoneName / ZoneGroup). Reads open to any RouteBuilder.Read user;
/// writes gated on RouteBuilder.Admin.
/// </summary>
[ApiController]
[Route("api/territory")]
[Authorize(Policy = "RouteBuilder.Read")]
// Access Control switch: the v1 Schedules page (Zones, Zone Groups and Depots tabs) (Routed Ops switches spec step 3b).
// Actions other pages call declare their own keys below, which replace this one.
[RequireFeature("ro-schedules")]
public class TerritoryController(TerritoryService svc, PolygonBindingService bindings) : BaseController
{
    // ─── POLYGON BINDINGS ──────────────────────────────────────────────────

    /// <summary>List polygons currently bound to a US ZoneName.</summary>
    [HttpGet("us/zone-names/{id:int}/polygons")]
    public async Task<IActionResult> GetPolygonsForZoneName(int id) =>
        Ok(new { response = await bindings.GetForZoneNameAsync(id) });

    /// <summary>List the shapes that are members of a zone inside this
    /// PostcodeGroup, each with the zone it joined.</summary>
    [HttpGet("postcode-groups/{id:int}/polygons")]
    public async Task<IActionResult> GetPolygonsForPostcodeGroup(int id) =>
        Ok(new { response = await bindings.GetForPostcodeGroupAsync(id) });

    /// <summary>Bind (or clear) a polygon's US ZoneName. Group membership is
    /// a zone row, written through POST /api/bulk-polygons/{id}/zones, not
    /// here.</summary>
    [HttpPost("polygons/{polygonId:int}/bind")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> BindPolygon(int polygonId, [FromBody] PolygonBindRequest req) =>
        await Wrap(() => bindings.BindZoneNameAsync(polygonId, req.ZoneNameId));

    // ─── READS ─────────────────────────────────────────────────────────────

    /// <summary>
    /// One-shot bootstrap for the Schedules module's Zones + Zone Groups
    /// tabs. Returns the tenant's CountryCode plus every list the tabs
    /// need. Drops the wrong-tenant lists (NZ payload gets no
    /// UsZipZones, and vice versa) to keep the wire payload small.
    /// </summary>
    [HttpGet("bootstrap")]
    public async Task<IActionResult> GetBootstrap()
    {
        var payload = await svc.GetBootstrapAsync();
        return Ok(new { response = payload });
    }

    /// <summary>
    /// Depots. Filter by client either by CODE (preferred - operators
    /// use ACME etc.) or by ID. If both are set, clientCode wins.
    /// Matches the legacy /API/Zones/Depots/Clients/{id} behaviour.
    /// </summary>
    [HttpGet("depots")]
    public async Task<IActionResult> GetDepots(
        [FromQuery] string clientCode = null,
        [FromQuery] int? clientId = null)
    {
        try
        {
            var id = !string.IsNullOrWhiteSpace(clientCode)
                ? await svc.ResolveClientCodeAsync(clientCode)
                : (clientId.HasValue && clientId.Value > 0 ? clientId : null);
            return Ok(new { response = await svc.GetDepotsAsync(id) });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>Resolve postcode → ZipPolygon ids the Schedule editor map
    /// should render. See PostcodesForScheduleRequest for the input shape.
    /// Reads only - unauthenticated / read-tier operators can call it.</summary>
    [HttpPost("postcodes-for-schedule")]
    // LOAD-BEARING: on the Schedules (NEW) create/edit path. Narrowing this breaks
    // schedule creation (an error, not a hidden page).
    [RequireFeature("ro-schedules", "ro-schedules-new", "ro-client-overrides")]
    public async Task<IActionResult> GetPostcodesForSchedule([FromBody] PostcodesForScheduleRequest req) =>
        await Wrap(() => svc.GetPostcodesForScheduleAsync(req));

    // ─── DEPOT ACTIVATE / DEACTIVATE ─────────────────────────────────────
    // Full depot maintenance (address, GPS, audit) stays in AdminManager.
    // Schedules module only exposes the on/off toggle operators use to
    // hide a retired depot from the schedule / linehaul / postcode-group
    // dropdowns without switching apps.

    [HttpPost("depots/{id:int}/deactivate")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeactivateDepot(int id) =>
        await Wrap(() => svc.SetDepotActiveAsync(id, false));

    [HttpPost("depots/{id:int}/reactivate")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> ReactivateDepot(int id) =>
        await Wrap(() => svc.SetDepotActiveAsync(id, true));

    /// <summary>Every depot with whether it is switched off for this client.
    /// Separate from GET depots?clientId, which filters to the depots the
    /// client can already reach.</summary>
    [HttpGet("depots/client-limits")]
    public async Task<IActionResult> GetDepotClientLimits([FromQuery] int clientId) =>
        await Wrap(() => svc.GetDepotClientLimitsAsync(clientId));

    /// <summary>Switch one depot off for one client, or back on.</summary>
    [HttpPost("depots/{id:int}/client-limit")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> SetDepotClientLimit(
        int id, [FromBody] DepotClientLimitRequest req) =>
        await Wrap(() => svc.SetDepotClientLimitAsync(id, req.ClientId, req.Off));

    /// <summary>
    /// Postcode groups. Filter by client CODE (preferred) or ID.
    /// If both are set, clientCode wins. Matches the legacy
    /// /API/BulkZonePostcodeGroups/Clients/{id} behaviour.
    /// </summary>
    [HttpGet("postcode-groups")]
    public async Task<IActionResult> GetPostcodeGroups(
        [FromQuery] string clientCode = null,
        [FromQuery] int? clientId = null)
    {
        try
        {
            var id = !string.IsNullOrWhiteSpace(clientCode)
                ? await svc.ResolveClientCodeAsync(clientCode)
                : (clientId.HasValue && clientId.Value > 0 ? clientId : null);
            return Ok(new { response = await svc.GetPostcodeGroupsAsync(id) });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// One postcode group plus everything that references it: its zones,
    /// the schedules using it for delivery and for pickup, and the
    /// polygons bound to it. Backs the group detail view.
    /// </summary>
    [HttpGet("postcode-groups/{id:int}/detail")]
    public async Task<IActionResult> GetPostcodeGroupDetail(int id) =>
        await Wrap(() => svc.GetPostcodeGroupDetailAsync(id));

    /// <summary>Boundaries for the map panel beside a zone group, shaded by
    /// zone, plus the depot pin.</summary>
    [HttpGet("postcode-groups/{id:int}/map")]
    public async Task<IActionResult> GetZoneMap(int id) =>
        await Wrap(() => svc.GetZoneMapAsync(id));

    [HttpGet("nz/postcodes")]
    // LOAD-BEARING: on the Schedules (NEW) create/edit path. Narrowing this breaks
    // schedule creation (an error, not a hidden page).
    [RequireFeature("ro-schedules-new", "ro-client-overrides")]
    public async Task<IActionResult> GetNzPostcodes() =>
        Ok(new { response = await svc.GetNzPostcodesAsync() });

    [HttpGet("us/zip-zones")]
    // LOAD-BEARING: on the Schedules (NEW) create/edit path. Narrowing this breaks
    // schedule creation (an error, not a hidden page).
    [RequireFeature("ro-schedules-new", "ro-client-overrides")]
    public async Task<IActionResult> GetUsZipZones() =>
        Ok(new { response = await svc.GetUsZipZonesAsync() });

    [HttpGet("us/zone-names")]
    public async Task<IActionResult> GetUsZoneNames() =>
        Ok(new { response = await svc.GetZoneNamesAsync() });

    [HttpGet("us/zone-groups")]
    public async Task<IActionResult> GetUsZoneGroups() =>
        Ok(new { response = await svc.GetZoneGroupsAsync() });

    /// <summary>Driver location lists (tblClearListArea) for the zone group
    /// form's Clear-List Area picker, ordered by Order then Name.</summary>
    [HttpGet("clear-list-areas")]
    public async Task<IActionResult> GetClearListAreas() =>
        Ok(new { response = await svc.GetClearListAreasAsync() });

    // ─── POSTCODE GROUP WRITES ─────────────────────────────────────────────

    [HttpPost("postcode-groups")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> CreatePostcodeGroup([FromBody] PostcodeGroupUpsertRequest req) =>
        await Wrap(() => svc.CreatePostcodeGroupAsync(req));

    [HttpPut("postcode-groups/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpdatePostcodeGroup(int id, [FromBody] PostcodeGroupUpsertRequest req) =>
        await Wrap(() => svc.UpdatePostcodeGroupAsync(id, req));

    [HttpDelete("postcode-groups/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeletePostcodeGroup(int id) =>
        await WrapVoid(() => svc.DeletePostcodeGroupAsync(id));

    /// <summary>
    /// Copy a group and its zone membership (spec 3.2). Schedules are not
    /// copied, because the copy is a new territory; rates are not either, that
    /// checkbox arrives with the Pricing tab.
    /// </summary>
    [HttpPost("postcode-groups/{id:int}/duplicate")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DuplicatePostcodeGroup(
        int id, [FromBody] PostcodeGroupDuplicateRequest req) =>
        await Wrap(() => svc.DuplicatePostcodeGroupAsync(id, req));

    // ─── NZ POSTCODE WRITES ────────────────────────────────────────────────

    /// <summary>
    /// Add many NZ postcodes to one zone of one group (spec 11.8). A postcode
    /// already in another zone of the same group is reported back, never moved.
    /// </summary>
    [HttpPost("postcode-groups/{id:int}/zones/{zone:int}/postcodes")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> PasteNzPostcodes(
        int id, int zone, [FromBody] NzPostcodePasteRequest req) =>
        await Wrap(() => svc.PasteNzPostcodesAsync(id, zone, req));

    // ─── ZONE GROUP CSV RE-UPLOAD (F4 / ZG3) ───────────────────────────────

    /// <summary>
    /// Diff a re-uploaded Zone,Postcode,Suburb export against the group:
    /// added, moved, removed, unrecognised, and any row errors. Writes
    /// nothing. NZ and US both; the service picks the table by tenant.
    /// </summary>
    [HttpPost("postcode-groups/{id:int}/import/preview")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> PreviewZoneGroupImport(int id, [FromBody] ZoneGroupImportRequest req) =>
        await WrapLogged("PreviewZoneGroupImport", writes: false, id, req, () => svc.PreviewZoneGroupImportAsync(id, req));

    /// <summary>
    /// Apply a re-upload in one transaction. Refuses (400, nothing written)
    /// on any row error or when the group changed since the preview token.
    /// Rows missing from the file are removed only with removeMissing.
    /// </summary>
    [HttpPost("postcode-groups/{id:int}/import/apply")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> ApplyZoneGroupImport(int id, [FromBody] ZoneGroupImportRequest req) =>
        await WrapLogged("ApplyZoneGroupImport", writes: true, id, req, () => svc.ApplyZoneGroupImportAsync(id, req));

    [HttpPost("nz/postcodes")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> CreateNzPostcode([FromBody] NzPostcodeUpsertRequest req) =>
        await Wrap(() => svc.CreateNzPostcodeAsync(req));

    [HttpPut("nz/postcodes/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpdateNzPostcode(int id, [FromBody] NzPostcodeUpsertRequest req) =>
        await Wrap(() => svc.UpdateNzPostcodeAsync(id, req));

    [HttpDelete("nz/postcodes/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeleteNzPostcode(int id) =>
        await WrapVoid(() => svc.DeleteNzPostcodeAsync(id));

    // ─── US ZIP ZONE WRITES ────────────────────────────────────────────────

    [HttpPost("us/zip-zones")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> CreateUsZipZone([FromBody] UsZipZoneUpsertRequest req) =>
        await Wrap(() => svc.CreateUsZipZoneAsync(req));

    [HttpPut("us/zip-zones/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpdateUsZipZone(int id, [FromBody] UsZipZoneUpsertRequest req) =>
        await Wrap(() => svc.UpdateUsZipZoneAsync(id, req));

    [HttpDelete("us/zip-zones/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeleteUsZipZone(int id) =>
        await WrapVoid(() => svc.DeleteUsZipZoneAsync(id));

    // ─── ZONE NAME WRITES (US) ─────────────────────────────────────────────

    [HttpPost("us/zone-names")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> CreateZoneName([FromBody] ZoneNameUpsertRequest req) =>
        await Wrap(() => svc.CreateZoneNameAsync(req));

    [HttpPut("us/zone-names/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpdateZoneName(int id, [FromBody] ZoneNameUpsertRequest req) =>
        await Wrap(() => svc.UpdateZoneNameAsync(id, req));

    [HttpDelete("us/zone-names/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeleteZoneName(int id) =>
        await WrapVoid(() => svc.DeleteZoneNameAsync(id));

    /// <summary>
    /// Add many ZIPs to one US zone in a single call. The Zones tab adds one
    /// per request, which is 602 submissions for Cheetah's Hub Group file.
    /// </summary>
    [HttpPost("us/zone-names/{id:int}/zips")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> PasteZoneZips(int id, [FromBody] ZoneZipPasteRequest req) =>
        await Wrap(() => svc.PasteZoneZipsAsync(id, req));

    // ─── ZONE GROUP WRITES (US) ────────────────────────────────────────────

    [HttpPost("us/zone-groups")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> CreateZoneGroup([FromBody] ZoneGroupUpsertRequest req) =>
        await Wrap(() => svc.CreateZoneGroupAsync(req));

    [HttpPut("us/zone-groups/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpdateZoneGroup(int id, [FromBody] ZoneGroupUpsertRequest req) =>
        await Wrap(() => svc.UpdateZoneGroupAsync(id, req));

    [HttpDelete("us/zone-groups/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeleteZoneGroup(int id) =>
        await WrapVoid(() => svc.DeleteZoneGroupAsync(id));

    // ─── HELPERS ───────────────────────────────────────────────────────────

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

    /// <summary>Wrap plus request / response logging under one MessageId,
    /// which a refusal also returns so a user can quote it. The CSV text is
    /// logged by size only: a whole group's file is noise in the log.</summary>
    private async Task<IActionResult> WrapLogged<T>(string action, bool writes, int groupId, ZoneGroupImportRequest req, Func<Task<T>> op)
    {
        var messageId = Guid.NewGuid();
        Serilog.Log.Information(
            "Request ({MessageId}): {Action} group {GroupId}, {CsvLength} chars, removeMissing {RemoveMissing}",
            messageId, action, groupId, req?.Csv?.Length ?? 0, req?.RemoveMissing ?? false);
        // Review n-a: no ModelState check here. [ApiController] answers an
        // invalid model before the action runs, so the check could never fire;
        // Csv is not [Required], so an empty file reaches this line, is logged
        // above (by size only) and is refused by the parser in plain words.
        try
        {
            var result = await op();
            // Counts only (review m3): a preview carries every added, moved
            // and removed row of the group, which is noise in the log.
            Serilog.Log.Information("Response ({MessageId}): {Action} {@Counts}", messageId, action, ImportCounts(result));
            return Ok(new { response = result });
        }
        catch (ZoneGroupImportStaleException ex)
        {
            // Review r3: the one refusal the panel answers by previewing again.
            Serilog.Log.Warning("Response ({MessageId}): {Action} refused, stale token", messageId, action);
            return BadRequest(new { message = ex.Message, messageId, code = "stale" });
        }
        catch (InvalidOperationException ex)
        {
            Serilog.Log.Warning("Response ({MessageId}): {Action} refused: {Message}", messageId, action, ex.Message);
            return BadRequest(new { message = ex.Message, messageId });
        }
        catch (DbUpdateException ex)
        {
            // Review m4: a database refusal (for example a missing grant on a
            // tenant) was a bare 500. The apply is one transaction, so nothing
            // was saved; the real error is logged under the MessageId.
            Serilog.Log.Error(ex, "Response ({MessageId}): {Action} database refused the save", messageId, action);
            return BadRequest(new
            {
                message = "Nothing was saved. The database refused the change; quote the reference to support.",
                messageId,
            });
        }
        catch (System.Data.Common.DbException ex)
        {
            // Review r4: a refusal on a READ (a missing SELECT grant, a
            // timeout) is a DbException, not a DbUpdateException, and was a
            // bare 500. Same log as the save arm. Nit 2: a preview only reads,
            // so it says so; an apply is one transaction, so on any database
            // error nothing was saved.
            Serilog.Log.Error(ex, "Response ({MessageId}): {Action} database refused the request", messageId, action);
            return BadRequest(new
            {
                message = writes
                    ? "Nothing was saved. The database refused the change; quote the reference to support."
                    : "The group could not be read. The database refused the request; quote the reference to support.",
                messageId,
            });
        }
    }

    private static object? ImportCounts(object? result) => result switch
    {
        ZoneGroupCsvImport.ZoneGroupImportPreview p => new
        {
            Added = p.Added.Count, Moved = p.Moved.Count, Removed = p.Removed.Count,
            Unrecognised = p.Unrecognised.Count, p.Unchanged, Errors = p.Errors.Count,
        },
        _ => result,
    };

    private async Task<IActionResult> WrapVoid(Func<Task> op)
    {
        try
        {
            await op();
            return Ok(new { response = "Deleted" });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
