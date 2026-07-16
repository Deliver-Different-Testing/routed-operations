using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.Speed;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/speeds")]
[Authorize(Policy = "RouteBuilder.Read")]
public class SpeedsController(SpeedService speedService) : BaseController
{
    // GET /api/speeds?runDate=
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] DateTime runDate)
    {
        var speeds = await speedService.GetForRunDateAsync(runDate);
        return Ok(speeds);
    }

    // GET /api/speeds/all
    [HttpGet("all")]
    public async Task<IActionResult> GetAll()
    {
        var speeds = await speedService.GetAllAsync();
        return Ok(speeds);
    }
}
