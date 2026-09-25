using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.Region;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/regions")]
[Authorize(Policy = "RouteBuilder.Read")]
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
