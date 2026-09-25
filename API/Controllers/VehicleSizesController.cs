using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.VehicleSize;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/vehicle-sizes")]
[Authorize(Policy = "RouteBuilder.Read")]
public class VehicleSizesController(VehicleSizeService vehicleSizeService) : BaseController
{
    // GET /api/vehicle-sizes  - options for the Vehicle Capacity build constraint
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var sizes = await vehicleSizeService.GetAllAsync();
        return Ok(new { response = sizes });
    }
}
