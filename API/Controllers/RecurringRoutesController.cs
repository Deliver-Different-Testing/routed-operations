using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RecurringRoute;
using RoutedOperations.Core.Application.Services.RecurringRoute;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Recurring routes module (Stage 2 - C.1'/C.2'/C.3'). Shares the Configurator
/// Route + ZipPolygon + Dispatch_RouteRoster tables rather than creating a
/// parallel set. Route Builder surface + Configurator DF Admin surface stay
/// in sync automatically.
/// </summary>
[ApiController]
[Route("api/recurring-routes")]
[Authorize(Policy = "RouteBuilder.Read")]
public class RecurringRoutesController(RecurringRouteService routes) : BaseController
{
    // ─── ROUTES ────────────────────────────────────────────────────────────

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var list = await routes.GetAllAsync();
        return Ok(new { response = list });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetOne(int id)
    {
        var r = await routes.GetByIdAsync(id);
        return r is null ? NotFound() : Ok(new { response = r });
    }

    [HttpPost]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Create([FromBody] UpsertRouteRequest req)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        try
        {
            var created = await routes.CreateAsync(req);
            return Ok(new { response = created });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpsertRouteRequest req)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        try
        {
            var updated = await routes.UpdateAsync(id, req);
            return updated is null ? NotFound() : Ok(new { response = updated });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("{sourceRouteId:int}/copy")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Copy(int sourceRouteId, [FromBody] CopyRouteRequest req)
    {
        var copy = await routes.CopyAsync(sourceRouteId, req);
        return copy is null ? NotFound() : Ok(new { response = copy });
    }

    [HttpDelete("{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var ok = await routes.SoftDeleteAsync(id);
        return ok ? Ok(new { response = "Deactivated" }) : NotFound();
    }

    // Live recurring bookings bound to this route. Read-only drill-down for
    // the "Bookings on this route (N)" collapsible section in the edit modal.
    [HttpGet("{routeId:int}/bookings")]
    public async Task<IActionResult> GetBookings(int routeId)
    {
        var list = await routes.GetBookingsAsync(routeId);
        return Ok(new { response = list });
    }

    // Live materialised jobs on this route (Mapped Stops drill-down list).
    // Same shape as /api/recurring-linehaul-runs/{id}/jobs so the frontend
    // reuses the MappedStopsDrilldown component.
    [HttpGet("{routeId:int}/jobs")]
    public async Task<IActionResult> GetMappedStops(int routeId)
    {
        var list = await routes.GetMappedStopsAsync(routeId);
        return Ok(new { response = list });
    }

    // ─── ROSTER ────────────────────────────────────────────────────────────

    [HttpGet("{routeId:int}/roster")]
    public async Task<IActionResult> GetRoster(int routeId)
    {
        var list = await routes.GetRosterAsync(routeId);
        return Ok(new { response = list });
    }

    [HttpPost("{routeId:int}/roster")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> AddRoster(int routeId, [FromBody] UpsertRouteRosterRequest req)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        try
        {
            var entry = await routes.AddRosterAsync(routeId, req);
            return entry is null ? NotFound() : Ok(new { response = entry });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("{routeId:int}/roster/{rosterId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeleteRoster(int routeId, int rosterId)
    {
        var ok = await routes.DeleteRosterAsync(routeId, rosterId);
        return ok ? Ok(new { response = "Deactivated" }) : NotFound();
    }

    // ─── LOOKUPS ───────────────────────────────────────────────────────────

    [HttpGet("zipcodes/search")]
    public async Task<IActionResult> SearchZipcodes([FromQuery] string q, [FromQuery] int max = 25)
    {
        var list = await routes.SearchZipcodesAsync(q, max);
        return Ok(new { response = list });
    }

    /// <summary>
    /// Returns every zip's identity + centroid so the Polygon Builder can
    /// render a full-tenant marker layer client-side. Response is cached
    /// for the browser session; per-zip WKT still fetched on demand via
    /// the shapes endpoint below.
    /// </summary>
    [HttpGet("zipcodes/centroids")]
    public async Task<IActionResult> GetAllZipcodeCentroids()
    {
        var list = await routes.GetAllZipcodeCentroidsAsync();
        return Ok(new { response = list });
    }

    [HttpPost("zipcodes/shapes")]
    public async Task<IActionResult> GetPolygonShapes([FromBody] List<int> zipPolygonIds)
    {
        var list = await routes.GetPolygonShapesAsync(zipPolygonIds ?? new List<int>());
        return Ok(new { response = list });
    }

    [HttpGet("assignable-targets")]
    public async Task<IActionResult> GetAssignableTargets()
    {
        var res = await routes.GetAssignableTargetsAsync();
        return Ok(new { response = res });
    }

    [HttpGet("schedules/lookup")]
    public async Task<IActionResult> GetSchedulesLookup()
    {
        var list = await routes.GetSchedulesLookupAsync();
        return Ok(new { response = list });
    }
}
