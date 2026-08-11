// Route Viewer label endpoints. Calls RouteViewerLabelService which
// proxies to the legacy RunViewer /Home/Labels/* URLs. Env var
// RunViewerLabelProxyUrl activates the proxy; missing = 501 with
// a specific "set this env var" message.
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/labels")]
[Authorize(Policy = "RouteViewer.Read")]
public class RunViewerLabelController(
    RouteViewerLabelService labelService) : BaseController
{
    /// <summary>GET /api/runviewer/labels/jobs/{jobId} - single-job
    /// tucJob label PDF (Mode 1).</summary>
    [HttpGet("jobs/{jobId:int}")]
    public Task<IActionResult> GetSingleJobLabel(int jobId) =>
        LabelPdfAsync(labelService.GetSingleJobLabelAsync(jobId), $"job-{jobId}");

    /// <summary>GET /api/runviewer/labels/lhp-jobs/{jobId} - LHP single
    /// label (Mode 1, default bulk template).</summary>
    [HttpGet("lhp-jobs/{jobId:int}")]
    public Task<IActionResult> GetLhpJobLabel(int jobId) =>
        LabelPdfAsync(labelService.GetLhpJobLabelAsync(jobId), $"lhp-{jobId}");

    /// <summary>GET /api/runviewer/labels/bulk?bulkJobId= - single
    /// bulk-label PDF (Mode 2).</summary>
    [HttpGet("bulk")]
    public Task<IActionResult> GetSingleBulkLabel([FromQuery] int bulkJobId) =>
        LabelPdfAsync(labelService.GetSingleBulkLabelAsync(bulkJobId), $"bulk-{bulkJobId}");

    /// <summary>POST /api/runviewer/labels/bulk-jobs - Mode 4 bulk
    /// labels by run (or Mode 8 for routed run).</summary>
    [HttpPost("bulk-jobs")]
    public Task<IActionResult> GetBulkLabels([FromBody] LabelRequest request) =>
        LabelPdfAsync(labelService.GetBulkLabelsAsync(request), "bulk-jobs");

    /// <summary>POST /api/runviewer/labels/bulk-jobs-by-speed - Mode 5.</summary>
    [HttpPost("bulk-jobs-by-speed")]
    public Task<IActionResult> GetBulkLabelsBySpeed([FromBody] LabelRequest request) =>
        LabelPdfAsync(labelService.GetBulkLabelsBySpeedAsync(request), "bulk-jobs-by-speed");

    /// <summary>POST /api/runviewer/labels/linehaul-jobs - Mode 6.
    /// NP blocked.</summary>
    [HttpPost("linehaul-jobs")]
    public Task<IActionResult> GetLineHaulLabels([FromBody] LabelRequest request) =>
        LabelPdfAsync(labelService.GetLineHaulLabelsAsync(request), "linehaul-jobs");

    /// <summary>GET /api/runviewer/labels/linehaul-manifest?... -
    /// CSV export.</summary>
    [HttpGet("linehaul-manifest")]
    public async Task<IActionResult> GetLineHaulManifest([FromQuery] LabelRequest request)
    {
        try
        {
            var csv = await labelService.GetLineHaulManifestCsvAsync(request);
            return File(System.Text.Encoding.UTF8.GetBytes(csv), "text/csv",
                $"linehaul-manifest-{DateTime.Today:yyyy-MM-dd}.csv");
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(501, new { message = ex.Message });
        }
    }

    private static async Task<IActionResult> LabelPdfAsync(Task<byte[]> generator, string tag)
    {
        try
        {
            var bytes = await generator;
            return new FileContentResult(bytes, "application/pdf") { FileDownloadName = $"{tag}.pdf" };
        }
        catch (InvalidOperationException ex)
        {
            return new ObjectResult(new { message = ex.Message })
            {
                StatusCode = StatusCodes.Status501NotImplemented,
            };
        }
    }
}
