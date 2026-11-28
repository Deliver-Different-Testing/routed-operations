// Route Viewer 3-way assign + unassign endpoints. All under
// /api/runviewer/jobs/* (NP-scope aware via INpScopeGuard).
using Microsoft.AspNetCore.Authorization;
using DeliverDifferent.AccessControl.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/jobs")]
[Authorize(Policy = "RouteViewer.Read")]
// Access Control switch, ANY of the Route Viewer pages that call this:
// Runs and Linehaul (assign / unassign dialogs) (spec step 3b).
[RequireFeature("ro-route-viewer-runs", "ro-linehaul")]
public class RunViewerAssignmentController(
    RouteViewerAssignmentService assignmentService) : BaseController
{
    // Cheetah R2: plain operator text, never field names.
    internal const string PickRunMessage = "Pick a run first.";
    internal const string PickDriverMessage = "Pick a driver first.";
    internal const string NoDriverMessage = "This run has no driver to remove.";

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

    /// <summary>POST /api/runviewer/jobs/preassign-run - drag-drop
    /// entry point. Normal run: RVW_stpPreAssignRun (status 18), returns
    /// "ok". Route run (RunId &lt; 0): RVW_stpTransferRun (restore, then
    /// despatch), returns the per-job outcome. Optional FromCourierCode
    /// limits it to that courier's jobs.</summary>
    [HttpPost("preassign-run")]
    [Authorize(Policy = "RouteViewer.Admin")]
    public async Task<IActionResult> PreAssignRun([FromBody] PreAssignRunRequest request)
    {
        // Cheetah R2: a CAPS route run has RunId = -RouteId; only 0 is invalid.
        if (request.RunId == 0)
            return BadRequest(new { message = PickRunMessage });
        if (string.IsNullOrWhiteSpace(request.ToCourierCode))
            return BadRequest(new { message = PickDriverMessage });
        try
        {
            // A route run returns what happened per job (moved / skipped / failed).
            var outcome = await assignmentService.PreAssignRunAsync(request.RunId, request.FromCourierCode, request.ToCourierCode, request.RunDate);
            return outcome == null ? Ok(new { response = "ok" }) : Ok(new { response = outcome });
        }
        catch (RunCourierRejectedException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>POST /api/runviewer/jobs/transfer-run - bulk-transfer
    /// every job on a run from one courier to another. Wraps
    /// RVW_stpTransferRun.</summary>
    [HttpPost("transfer-run")]
    [Authorize(Policy = "RouteViewer.Admin")]
    public async Task<IActionResult> TransferRun([FromBody] TransferRunRequest request)
    {
        if (request.RunId == 0)
            return BadRequest(new { message = PickRunMessage });
        if (string.IsNullOrWhiteSpace(request.ToCourierCode))
            return BadRequest(new { message = PickDriverMessage });
        try
        {
            await assignmentService.TransferRunAsync(request.RunId, request.FromCourierCode ?? string.Empty, request.ToCourierCode, request.RunDate);
            return Ok(new { response = "ok" });
        }
        catch (RunCourierRejectedException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>POST /api/runviewer/jobs/release-run - soft release a
    /// courier from a run. Wraps RVW_stpReleaseRun.</summary>
    [HttpPost("release-run")]
    [Authorize(Policy = "RouteViewer.Admin")]
    public async Task<IActionResult> ReleaseRun([FromBody] ReleaseRunRequest request)
    {
        if (request.RunId == 0)
            return BadRequest(new { message = PickRunMessage });
        if (string.IsNullOrWhiteSpace(request.CourierCode))
            return BadRequest(new { message = NoDriverMessage });
        try
        {
            await assignmentService.ReleaseRunAsync(request.RunId, request.CourierCode, request.RunDate);
            return Ok(new { response = "ok" });
        }
        catch (RunCourierRejectedException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>POST /api/runviewer/jobs/unassign-run - hard unassign
    /// a courier from a run. Wraps RVW_stpUnAssignRun.</summary>
    [HttpPost("unassign-run")]
    [Authorize(Policy = "RouteViewer.Admin")]
    public async Task<IActionResult> UnAssignRun([FromBody] UnAssignRunRequest request)
    {
        if (request.RunId == 0)
            return BadRequest(new { message = PickRunMessage });
        if (string.IsNullOrWhiteSpace(request.CourierCode))
            return BadRequest(new { message = NoDriverMessage });
        try
        {
            await assignmentService.UnAssignRunAsync(request.RunId, request.CourierCode, request.RunDate);
            return Ok(new { response = "ok" });
        }
        catch (RunCourierRejectedException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>POST /api/runviewer/jobs/transfer-original-run-order -
    /// reassign the run's ORIGINAL owner (drives reporting +
    /// courier-percentage rollups). Wraps RVW_stpTransferOriginalRunOrder.</summary>
    [HttpPost("transfer-original-run-order")]
    [Authorize(Policy = "RouteViewer.Admin")]
    public async Task<IActionResult> TransferOriginalRunOrder([FromBody] TransferOriginalRunOrderRequest request)
    {
        if (request.RunId == 0)
            return BadRequest(new { message = PickRunMessage });
        if (string.IsNullOrWhiteSpace(request.ToCourierCode))
            return BadRequest(new { message = PickDriverMessage });
        try
        {
            await assignmentService.TransferOriginalRunOrderAsync(request.RunId, request.ToCourierCode);
            return Ok(new { response = "ok" });
        }
        catch (RunCourierRejectedException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }
}
