// Courier + GPS-lookup endpoints for Route Viewer. All 5 endpoints
// return empty for NP sessions (enforced inside the service layer via
// INpScopeResolver.IsAdmin - NP portal clients do not see courier
// data).
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/couriers")]
[Authorize(Policy = "RouteViewer.Read")]
public class RunViewerCourierController(
    RouteViewerCourierService courierService) : BaseController
{
    /// <summary>GET /api/runviewer/couriers?runDate= - active courier
    /// picker rows for the potentialCouriers box.</summary>
    [HttpGet]
    public async Task<IActionResult> GetActiveCouriers([FromQuery] DateTime? runDate)
    {
        var rows = await courierService.GetActiveCouriersAsync(runDate);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/couriers/search?q= - typeahead
    /// search for the Top Up dialog + Assign Route dialog fallback.
    /// </summary>
    [HttpGet("search")]
    public async Task<IActionResult> SearchCouriers([FromQuery] string? q)
    {
        var rows = await courierService.SearchActiveCouriersAsync(q);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/couriers/position?jobId= -
    /// current-job courier's last GPS ping today.</summary>
    [HttpGet("position")]
    public async Task<IActionResult> GetCourierPosition([FromQuery] int jobId)
    {
        var position = await courierService.GetCourierPositionAsync(jobId);
        return Ok(new { response = position });
    }

    /// <summary>GET /api/runviewer/couriers/available?minLng&minLat&maxLng&maxLat
    /// All-couriers map-viewport bounded positions.</summary>
    [HttpGet("available")]
    public async Task<IActionResult> GetAvailableCouriers(
        [FromQuery] decimal minLng,
        [FromQuery] decimal minLat,
        [FromQuery] decimal maxLng,
        [FromQuery] decimal maxLat)
    {
        var rows = await courierService.GetAvailableCourierPositionsAsync(minLng, minLat, maxLng, maxLat);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/couriers/route?code&start&end - GPS
    /// trail for the Courier Route red-polyline map overlay.</summary>
    [HttpGet("route")]
    public async Task<IActionResult> GetCourierRoute(
        [FromQuery] string code,
        [FromQuery] DateTime start,
        [FromQuery] DateTime end)
    {
        if (string.IsNullOrWhiteSpace(code))
            return BadRequest(new { message = "Courier code is required." });

        var rows = await courierService.GetCourierRouteAsync(code, start, end);
        return Ok(new { response = rows });
    }
}
