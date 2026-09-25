using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.Courier;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/couriers")]
[Authorize(Policy = "RouteBuilder.Read")]
public class CouriersController(CourierService courierService) : BaseController
{
    // GET /api/couriers            - flat list of active couriers
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var couriers = await courierService.GetActiveAsync();
        return Ok(new { PotentialCouriers = couriers });
    }
}
