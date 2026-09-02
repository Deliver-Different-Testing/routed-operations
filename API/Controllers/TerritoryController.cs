using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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
public class TerritoryController(TerritoryService svc, PolygonBindingService bindings) : BaseController
{
    // ─── POLYGON BINDINGS ──────────────────────────────────────────────────

    /// <summary>List polygons currently bound to a US ZoneName.</summary>
    [HttpGet("us/zone-names/{id:int}/polygons")]
    public async Task<IActionResult> GetPolygonsForZoneName(int id) =>
        Ok(new { response = await bindings.GetForZoneNameAsync(id) });

    /// <summary>List polygons currently bound to a PostcodeGroup.</summary>
    [HttpGet("postcode-groups/{id:int}/polygons")]
    public async Task<IActionResult> GetPolygonsForPostcodeGroup(int id) =>
        Ok(new { response = await bindings.GetForPostcodeGroupAsync(id) });

    /// <summary>Bind (or clear) a polygon's zone / postcode-group binding.
    /// Null on both fields clears every binding on the polygon.</summary>
    [HttpPost("polygons/{polygonId:int}/bind")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> BindPolygon(int polygonId, [FromBody] PolygonBindRequest req) =>
        await Wrap(() => bindings.BindAsync(polygonId, req.ZoneNameId, req.PostcodeGroupId));

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

    [HttpGet("nz/postcodes")]
    public async Task<IActionResult> GetNzPostcodes() =>
        Ok(new { response = await svc.GetNzPostcodesAsync() });

    [HttpGet("us/zip-zones")]
    public async Task<IActionResult> GetUsZipZones() =>
        Ok(new { response = await svc.GetUsZipZonesAsync() });

    [HttpGet("us/zone-names")]
    public async Task<IActionResult> GetUsZoneNames() =>
        Ok(new { response = await svc.GetZoneNamesAsync() });

    [HttpGet("us/zone-groups")]
    public async Task<IActionResult> GetUsZoneGroups() =>
        Ok(new { response = await svc.GetZoneGroupsAsync() });

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

    // ─── NZ POSTCODE WRITES ────────────────────────────────────────────────

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
