// Two-step Transfer Route endpoints. Sit under /api/runviewer/* (not
// under /api/runviewer/jobs/) because the "active routes" endpoint is
// a route-scoped read, not a job-scoped one.
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer")]
[Authorize(Policy = "RouteViewer.Read")]
public class RunViewerRouteTransferController(
    RouteViewerRouteTransferService transferService) : BaseController
{
    /// <summary>GET /api/runviewer/routes/active?anchorJobId= -
    /// Step 1 pick (active routes + current-route badge).</summary>
    [HttpGet("routes/active")]
    public async Task<IActionResult> GetTransferContext([FromQuery] int? anchorJobId)
    {
        try
        {
            var ctx = await transferService.GetTransferContextAsync(anchorJobId);
            return Ok(new { response = ctx });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/runviewer/jobs/transfer-preview?ids=CSV -
    /// Step 2 confirm-preview rows.</summary>
    [HttpGet("jobs/transfer-preview")]
    public async Task<IActionResult> GetTransferPreview([FromQuery] string ids)
    {
        try
        {
            var preview = await transferService.GetTransferPreviewAsync(ids);
            return Ok(new { response = preview });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>POST /api/runviewer/jobs/transfer-route - Step 3 submit
    /// with the two opt-in cascade flags.</summary>
    [HttpPost("jobs/transfer-route")]
    [Authorize(Policy = "RouteViewer.Admin")]
    public async Task<IActionResult> Transfer([FromBody] TransferRouteRequest request)
    {
        if (request.JobIds.Count == 0 || request.NewRouteId <= 0)
            return BadRequest(new { message = "JobIds and NewRouteId are required." });

        try
        {
            var result = await transferService.TransferAsync(request);
            return Ok(new { response = result });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }
}
