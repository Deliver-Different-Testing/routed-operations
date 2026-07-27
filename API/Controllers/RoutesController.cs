using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.Route;
using RoutedOperations.Core.Application.Services.Routing;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Server-side proxies for the route optimisation vendors. Keeps API keys out
/// of the browser and preserves the legacy request/response shape.
/// </summary>
[ApiController]
[Route("api/routes")]
[Authorize(Policy = "RouteBuilder.Build")]
public class RoutesController(
    RouteOptimizationService routeOptimizationService,
    HereMapService hereMapService) : BaseController
{
    // POST /api/routes/optimize   body: List<SavvyLocationDto>
    [HttpPost("optimize")]
    public async Task<IActionResult> Optimize([FromBody] List<SavvyLocationDto> waypoints)
    {
        var routes = await routeOptimizationService.OptimizeAsync(waypoints);
        return Ok(new { routes });
    }

    // POST /api/routes/optimize-with-name   body: List<SavvyLocationDto>
    [HttpPost("optimize-with-name")]
    public async Task<IActionResult> OptimizeWithName([FromBody] List<SavvyLocationDto> waypoints)
    {
        var routes = await routeOptimizationService.OptimizeWithNamesAsync(waypoints);
        return Ok(new { routes });
    }

    // POST /api/routes/here-sequence   body: { requestData }
    [HttpPost("here-sequence")]
    public async Task<IActionResult> HereSequence([FromBody] HereMapSequenceRequest body)
    {
        var result = await hereMapService.SequenceAsync(body);
        return Ok(result);
    }

    // POST /api/routes/here-sequence-typed   body: HereSequenceRequestTyped
    // Typed variant used by the Delivery Window build flow. Returns ordered
    // names + total minutes + per-leg minutes so the client can populate
    // legMinutes into splitOrderedJobsByConstraints without exposing the API key.
    [HttpPost("here-sequence-typed")]
    public async Task<IActionResult> HereSequenceTyped([FromBody] HereSequenceRequestTyped body)
    {
        var result = await hereMapService.SequenceTypedAsync(body);
        return Ok(result);
    }

    // POST /api/routes/polyline   body: RoutePolylineRequest
    // Server-side proxy for HERE Routing v8 polyline draws. Replaces the
    // Google Directions call on the cockpit map so the Google Directions API
    // billing SKU stays at zero. Returns { points: [{lat, lng}, ...] } or a
    // null Points list on failure - the caller (GoogleMap.tsx drawRunPolyline)
    // treats null as "keep the straight-line fallback".
    [HttpPost("polyline")]
    public async Task<IActionResult> Polyline([FromBody] RoutePolylineRequest body)
    {
        var points = await hereMapService.RoutePolylineAsync(body.Stops);
        return Ok(new RoutePolylineResponse { Points = points ?? new List<LatLngDto>() });
    }
}
