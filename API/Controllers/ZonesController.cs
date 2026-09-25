using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.Zone;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Read-only rating-geography endpoint for the Polygon Builder "VIEW Zones"
/// drawer. See George's spec `POLYGON-BUILDER-VIEW-ZONES-NZ-US-HANDOVER-
/// 2026-07-30` for shape + intent.
/// </summary>
[ApiController]
[Route("api/zones")]
[Authorize(Policy = "RouteBuilder.Polygon")]
public class ZonesController(ZoneLookupService svc) : BaseController
{
    [HttpGet("rating-postcodes")]
    public async Task<IActionResult> GetRatingPostcodes()
    {
        var list = await svc.GetRatingZonesAsync();
        return Ok(new { response = list });
    }
}
