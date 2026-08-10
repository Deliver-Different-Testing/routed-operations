// Route Viewer single-job read endpoints. Consumed by Home Detail
// refresh + CS event drill-down + Print Manager grid + multibox
// expand. All routes under /api/runviewer/jobs/*.
//
// Note the intentional distinction from AssignmentController which
// also lives under /api/runviewer/jobs/* - Assignment owns the write
// side (assign, unassign, transfer). This controller owns the read
// side.
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/jobs")]
[Authorize(Policy = "RouteViewer.Read")]
public class RunViewerJobController(
    RouteViewerJobService jobService) : BaseController
{
    /// <summary>
    /// GET /api/runviewer/jobs/{bulkJobId} - single BulkJob read.
    /// T.8 gap: SP does not project ParentJobID; frontend Related-tabs
    /// falls back to jobNumber-suffix heuristic.
    /// </summary>
    [HttpGet("{bulkJobId:int}")]
    public async Task<IActionResult> GetBulkJob(int bulkJobId)
    {
        try
        {
            var job = await jobService.GetBulkJobAsync(bulkJobId);
            if (job == null) return NotFound();
            return Ok(new { response = job });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/runviewer/jobs/search?jobNumber= - Home top-bar
    /// job search + CS job-typeahead.
    /// </summary>
    [HttpGet("search")]
    public async Task<IActionResult> SearchByJobNumber([FromQuery] string jobNumber)
    {
        if (string.IsNullOrWhiteSpace(jobNumber))
            return BadRequest(new { message = "jobNumber is required." });

        try
        {
            var job = await jobService.SearchByJobNumberAsync(jobNumber);
            if (job == null) return NotFound();
            return Ok(new { response = job });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/runviewer/jobs/print-list?... - Print Manager grid.
    /// Reuses the BulkRunListRequest query shape (same filter set).
    /// </summary>
    [HttpGet("print-list")]
    public async Task<IActionResult> GetPrintJobList([FromQuery] BulkRunListRequest request)
    {
        try
        {
            var jobs = await jobService.GetPrintJobListAsync(request);
            return Ok(new { response = jobs });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>
    /// GET /api/runviewer/jobs/print-children?runDate=&bulkJobId= -
    /// multibox chevron expand for a Print Manager parent row.
    /// </summary>
    [HttpGet("print-children")]
    public async Task<IActionResult> GetPrintJobChildren(
        [FromQuery] DateTime? runDate,
        [FromQuery] int bulkJobId)
    {
        try
        {
            var children = await jobService.GetPrintJobChildrenAsync(runDate, bulkJobId);
            return Ok(new { response = children });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/runviewer/jobs/items?bulkJobId=&runDate= -
    /// per-item barcode rows for multibox expand + Scan Manager
    /// grandchild rows.</summary>
    [HttpGet("items")]
    public async Task<IActionResult> GetJobItems(
        [FromQuery] int bulkJobId,
        [FromQuery] DateTime? runDate)
    {
        try
        {
            var items = await jobService.GetJobItemsAsync(bulkJobId, runDate);
            return Ok(new { response = items });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/runviewer/jobs/client-intel?mobile= - intel
    /// record for a customer phone.</summary>
    [HttpGet("client-intel")]
    public async Task<IActionResult> GetClientIntel([FromQuery] string mobile)
    {
        if (string.IsNullOrWhiteSpace(mobile))
            return BadRequest(new { message = "mobile is required." });
        var intel = await jobService.GetClientIntelAsync(mobile);
        return Ok(new { response = intel });
    }

    /// <summary>GET /api/runviewer/jobs/client-intel-images?mobile= -
    /// intel photo carousel (base64-serialised byte[] photos).</summary>
    [HttpGet("client-intel-images")]
    public async Task<IActionResult> GetClientIntelImages([FromQuery] string mobile)
    {
        if (string.IsNullOrWhiteSpace(mobile))
            return BadRequest(new { message = "mobile is required." });
        var images = await jobService.GetClientIntelImagesAsync(mobile);
        return Ok(new { response = images });
    }

    /// <summary>GET /api/runviewer/jobs/pod-photos?bulkJobId= - POD
    /// photos + delivery signature for the Detail carousel.</summary>
    [HttpGet("pod-photos")]
    public async Task<IActionResult> GetBulkJobPhotos([FromQuery] int bulkJobId)
    {
        try
        {
            var photos = await jobService.GetBulkJobPhotosAsync(bulkJobId);
            return Ok(new { response = photos });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/runviewer/jobs/linehaul?depotId&name&... -
    /// linehaul jobs for a given depot + run name.</summary>
    [HttpGet("linehaul")]
    public async Task<IActionResult> GetLinehaulJobs(
        [FromQuery] int? depotId,
        [FromQuery] string? name,
        [FromQuery] BulkRunListRequest request)
    {
        try
        {
            var jobs = await jobService.GetLinehaulJobsAsync(depotId, name, request);
            return Ok(new { response = jobs });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }

    /// <summary>GET /api/runviewer/jobs/search-data - topbar search
    /// dataset (90s SP timeout; blocked for NP).</summary>
    [HttpGet("search-data")]
    public async Task<IActionResult> GetJobSearchData([FromQuery] BulkRunListRequest request)
    {
        var jobs = await jobService.GetJobSearchDataAsync(request);
        return Ok(new { response = jobs });
    }
}
