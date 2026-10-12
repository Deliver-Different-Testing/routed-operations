using Microsoft.AspNetCore.Authorization;
using DeliverDifferent.AccessControl.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.Courier;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/fleets")]
[Authorize(Policy = "RouteBuilder.Read")]
// Access Control switch: Route Builder, the only page that calls this (Routed Ops switches spec step 3b).
[RequireFeature("ro-route-builder")]
public class FleetsController(CourierService courierService) : BaseController
{
    // GET /api/fleets              - couriers grouped by fleet
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var fleets = await courierService.GetActiveByFleetAsync();
        return Ok(new { fleets });
    }
}
