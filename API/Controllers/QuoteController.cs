using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.Quote;
using RoutedOperations.Core.Application.Services.Quote;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Quoting module (Stage 2 - C.3). Upload shadow jobs, run pricing
/// simulations, tear down when done. All operations scoped by QuoteSetCode
/// so multiple concurrent quote scenarios don't collide.
/// </summary>
[ApiController]
[Route("api/quote")]
[Authorize(Policy = "RouteBuilder.Quote")]
public class QuoteController(QuoteService quote) : BaseController
{
    [HttpGet("sets")]
    public async Task<IActionResult> GetSets()
    {
        var sets = await quote.GetSetsAsync();
        return Ok(new { response = sets });
    }

    [HttpPost("upload")]
    public async Task<IActionResult> Upload([FromBody] QuoteUploadRequest req)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        if (string.IsNullOrWhiteSpace(req.QuoteSetCode))
            return BadRequest(new { message = "QuoteSetCode is required" });
        var result = await quote.UploadAsync(req);
        return Ok(new { response = result });
    }

    [HttpPost("simulate")]
    public async Task<IActionResult> Simulate([FromBody] QuoteSimulateRequest req)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        var result = await quote.SimulateAsync(req);
        return Ok(new { response = result });
    }

    [HttpDelete("sets/{quoteSetCode}")]
    public async Task<IActionResult> DeleteSet(string quoteSetCode)
    {
        var deleted = await quote.DeleteSetAsync(quoteSetCode);
        return Ok(new { response = new { quoteSetCode, deleted } });
    }
}
