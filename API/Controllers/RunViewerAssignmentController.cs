// Route Viewer 3-way assign + unassign endpoints. All under
// /api/runviewer/jobs/* (NP-scope aware via INpScopeGuard).
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/jobs")]
[Authorize(Policy = "RouteViewer.Read")]
public class RunViewerAssignmentController(
    RouteViewerAssignmentService assignmentService) : BaseController
{
    /// <summary>GET /api/runviewer/jobs/{jobId}/assignable-targets -
    /// initial 3-bucket picker load.</summary>
    [HttpGet("{jobId:int}/assignable-targets")]
    public async Task<IActionResult> GetAssignableTargets(int jobId)
    {
        try
        {
            var targets = await assignmentService.GetAssignableTargetsAsync(jobId);
            return Ok(new { response = targets });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/runviewer/jobs/{jobId}/assignable-targets/couriers?q=&limit=
    /// - LIKE typeahead.</summary>
    [HttpGet("{jobId:int}/assignable-targets/couriers")]
    public async Task<IActionResult> SearchCouriers(
        int jobId,
        [FromQuery] string? q,
        [FromQuery] int limit = 50)
    {
        try
        {
            var couriers = await assignmentService.SearchCouriersAsync(jobId, q, limit);
            return Ok(new { response = couriers });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/runviewer/jobs/{jobId}/assignable-targets/agents?q=&isNetworkPartner=&limit=
    /// - LIKE typeahead over agents. NP-scoped -> empty.</summary>
    [HttpGet("{jobId:int}/assignable-targets/agents")]
    public async Task<IActionResult> SearchAgents(
        int jobId,
        [FromQuery] string? q,
        [FromQuery] bool isNetworkPartner = false,
        [FromQuery] int limit = 50)
    {
        try
        {
            var agents = await assignmentService.SearchAgentsAsync(jobId, q, isNetworkPartner, limit);
            return Ok(new { response = agents });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>POST /api/runviewer/jobs/assign - bulk assign.</summary>
    [HttpPost("assign")]
    [Authorize(Policy = "RouteViewer.Admin")]
    public async Task<IActionResult> Assign([FromBody] BulkAssignRequest request)
    {
        if (request.JobIds.Count == 0)
            return BadRequest(new { message = "JobIds is required." });

        try
        {
            var result = await assignmentService.AssignAsync(request);
            if (result.Succeeded == 0 && result.Failed > 0)
                return StatusCode(StatusCodes.Status500InternalServerError, new { response = result });
            return Ok(new { response = result });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>POST /api/runviewer/jobs/unassign - bulk unassign.</summary>
    [HttpPost("unassign")]
    [Authorize(Policy = "RouteViewer.Admin")]
    public async Task<IActionResult> Unassign([FromBody] BulkUnassignRequest request)
    {
        if (request.JobIds.Count == 0)
            return BadRequest(new { message = "JobIds is required." });

        try
        {
            var result = await assignmentService.UnassignAsync(request);
            return Ok(new { response = result });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }
}
