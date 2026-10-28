using Microsoft.AspNetCore.Authorization;
using DeliverDifferent.AccessControl.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.Region;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/regions")]
[Authorize(Policy = "RouteBuilder.Read")]
// Access Control switch: Route Builder, the only page that calls this (Routed Ops switches spec step 3b).
[RequireFeature("ro-route-builder")]
public class RegionsController(BulkRegionService bulkRegionService) : BaseController
{
    // GET /api/regions?runDate=
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] DateTime runDate)
    {
        var regions = await bulkRegionService.GetForRunDateAsync(runDate);
        return Ok(regions);
    }
}
