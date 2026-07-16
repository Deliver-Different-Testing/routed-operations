using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.Courier;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/fleets")]
[Authorize(Policy = "RouteBuilder.Read")]
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
