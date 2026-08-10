// Route Viewer read-side Run endpoints. Namespaced under
// `/api/runviewer/runs/*` per master Section 3.0 build rule (all Route
// Viewer REST endpoints under `/api/runviewer/*`; never under `/api/runs`
// which is Route Builder's domain).
//
// P1 delivers the primary read (BulkRunList). Additional endpoints
// (LinehaulRunList, JobSearchData, JobSearch, JobSiblings, LineHaulJobs,
// RunRegionOverview, LineHaulRegionOverview) follow the same shape and
// slot in below as their consuming UI phases (P3, P9, P11) mature.
//
// Every action inherits BaseController for the Guid message-id logging
// + BaseResponse pattern. NP-scope enforcement is done inside the
// service via INpScopeResolver (all rows filtered by @NpAgentId); the
// controller does not need to short-circuit for NP callers.
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Route Viewer run-list surface. Wraps RVW_stpBulkRuns_2 +
/// RVW_stpGetMissingJobRuns behind /api/runviewer/runs with tenant-TZ
/// normalisation + NP-scope filtering.
/// </summary>
[ApiController]
[Route("api/runviewer/runs")]
[Authorize(Policy = "RouteViewer.Read")]
public class RunViewerRunController(
    RouteViewerRunService runService) : BaseController
{
    /// <summary>
    /// GET /api/runviewer/runs?runDate=&clientInternal=&multipleClients=&clientId=&clientIds=&regionIds=&speedIds=&group=
    /// Primary Home-module run list. NP-scoped automatically via the
    /// service; NP users get filtered rows without any controller-side
    /// short-circuit.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetBulkRunList([FromQuery] BulkRunListRequest request)
    {
        try
        {
            var runs = await runService.GetBulkRunListAsync(request);
            return Ok(new { response = runs });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/runviewer/runs/{runId}/jobs - inner runBuilder grid rows
    /// for a single run. runDate is REQUIRED (SP raises on null for
    /// synthetic negative-id runs).
    /// </summary>
    [HttpGet("{runId:int}/jobs")]
    public async Task<IActionResult> GetBulkRunJobs(int runId, [FromQuery] BulkRunJobsRequest request)
    {
        try
        {
            var jobs = await runService.GetBulkRunJobsAsync(runId, request);
            return Ok(new { response = jobs });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/runviewer/runs/linehaul - cross-city trunk-move run list.
    /// </summary>
    [HttpGet("linehaul")]
    public async Task<IActionResult> GetLinehaulRunList([FromQuery] LinehaulRunListRequest request)
    {
        try
        {
            var runs = await runService.GetLinehaulRunListAsync(request);
            return Ok(new { response = runs });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/runviewer/runs/overview - region roll-up for Home
    /// overview box.
    /// </summary>
    [HttpGet("overview")]
    public async Task<IActionResult> GetRunRegionOverview([FromQuery] RegionOverviewRequest request)
    {
        try
        {
            var rows = await runService.GetRunRegionOverviewAsync(request);
            return Ok(new { response = rows });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/runviewer/runs/linehaul/overview - linehaul region
    /// roll-up (with Pallet column per Section 9.3).
    /// </summary>
    [HttpGet("linehaul/overview")]
    public async Task<IActionResult> GetLinehaulRegionOverview([FromQuery] RegionOverviewRequest request)
    {
        try
        {
            var rows = await runService.GetLinehaulRegionOverviewAsync(request);
            return Ok(new { response = rows });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/runviewer/runs/job-siblings?jobId= - Related-jobs tab
    /// strip family for the Detail panel.
    /// </summary>
    [HttpGet("job-siblings")]
    public async Task<IActionResult> GetJobSiblings([FromQuery] int jobId)
    {
        try
        {
            var siblings = await runService.GetJobSiblingsAsync(jobId);
            return Ok(new { response = siblings });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }
}
