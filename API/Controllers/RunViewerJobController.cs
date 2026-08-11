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

    /// <summary>POST /api/runviewer/jobs/{jobId}/pod-photo - upload a
    /// POD photo or delivery signature. Multipart form-data with the
    /// file field named `file`; optional `isSignature=true` query
    /// param routes to the DS/ prefix. Returns the S3 key on success.</summary>
    [HttpPost("{jobId:int}/pod-photo")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<IActionResult> UploadPodPhoto(
        int jobId,
        [FromForm] IFormFile file,
        [FromQuery] bool isSignature = false,
        [FromForm] string? description = null,
        [FromServices] S3PhotoReader s3 = null!)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "file is required." });
        try
        {
            using var stream = file.OpenReadStream();
            var key = await s3.UploadPodPhotoAsync(jobId, stream, file.ContentType ?? "image/jpeg", isSignature, description);
            return Ok(new { response = new { key } });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(501, new { message = ex.Message });
        }
    }

    /// <summary>DELETE /api/runviewer/jobs/pod-photo?key= - delete a
    /// POD photo by S3 key.</summary>
    [HttpDelete("pod-photo")]
    public async Task<IActionResult> DeletePodPhoto(
        [FromQuery] string key,
        [FromServices] S3PhotoReader s3)
    {
        if (string.IsNullOrWhiteSpace(key))
            return BadRequest(new { message = "key is required." });
        try
        {
            await s3.DeleteObjectAsync(key);
            return Ok(new { response = "ok" });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(501, new { message = ex.Message });
        }
    }

    /// <summary>POST /api/runviewer/jobs/{bulkJobId}/send-pod?toEmail=
    /// - email a POD photo. Proxies to the legacy /Home/SendPOD
    /// endpoint which owns the SES/SMTP transport.</summary>
    [HttpPost("{bulkJobId:int}/send-pod")]
    public async Task<IActionResult> SendPod(
        int bulkJobId,
        [FromQuery] string toEmail,
        [FromServices] RouteViewerLabelService labels)
    {
        if (string.IsNullOrWhiteSpace(toEmail))
            return BadRequest(new { message = "toEmail is required." });
        try
        {
            var ok = await labels.SendPodEmailAsync(bulkJobId, toEmail);
            if (!ok) return StatusCode(502, new { message = "SendPOD proxy returned non-200; check server logs." });
            return Ok(new { response = "ok" });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(501, new { message = ex.Message });
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
