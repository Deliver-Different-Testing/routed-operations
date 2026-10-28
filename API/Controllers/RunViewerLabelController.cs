// Route Viewer label endpoints. Calls RouteViewerLabelService which
// proxies to the legacy RunViewer /Home/Labels/* URLs. Env var
// RunViewerLabelProxyUrl activates the proxy; missing = 501 with
// a specific "set this env var" message.
//
// NpLabelScopeException -> 403, matching every other RunViewer
// controller. This one was missing the translation, so the two bulk
// flows that already guarded NP users surfaced a 500 instead.
using Microsoft.AspNetCore.Authorization;
using DeliverDifferent.AccessControl.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Serilog;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/labels")]
[Authorize(Policy = "RouteViewer.Read")]
// Access Control switch, ANY of the Route Viewer pages that call this:
// Runs, Print Manager and Linehaul (label PDFs, linehaul manifest) (spec step 3b).
[RequireFeature("ro-route-viewer-runs", "ro-print-manager", "ro-linehaul")]
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
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
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
        catch (NpLabelScopeException ex)
        {
            return new ObjectResult(new { message = ex.Message })
            {
                StatusCode = StatusCodes.Status403Forbidden,
            };
        }
        catch (InvalidOperationException ex)
        {
            return new ObjectResult(new { message = ex.Message })
            {
                StatusCode = StatusCodes.Status501NotImplemented,
            };
        }
        // Everything below used to be unhandled. There is no global exception
        // handler in this project, so an unhandled exception here returned a
        // bare 500 with an EMPTY body, and the frontend
        // (routeViewerService.ts) falls back to the literal string
        // "HTTP 500" when it cannot find body.message. That is the whole of
        // what ticket #855 could see: "Print run failed: HTTP 500", with the
        // real cause visible only in the server log.
        catch (SqlException ex)
        {
            // The SQL message names the object and the problem, which for a
            // permission or schema fault is the entire diagnosis. This
            // endpoint is behind RouteViewer.Read, and the
            // InvalidOperationException branch above already returns its own
            // message, so this leaks nothing new to an unauthenticated
            // caller.
            Log.Error(ex, "Label generation failed ({Tag}): SQL error {Number} - {Message}",
                tag, ex.Number, ex.Message);
            return new ObjectResult(new { message = $"Database error: {ex.Message}" })
            {
                StatusCode = StatusCodes.Status500InternalServerError,
            };
        }
        catch (Exception ex)
        {
            // Last resort. Carries the type name because the failure we are
            // chasing may not be a SqlException at all: an empty routed run
            // reached the PDF renderer with zero pages, and knowing which
            // exception type comes back is what tells us so. Full detail,
            // including the stack, goes to the log rather than the response.
            Log.Error(ex, "Label generation failed ({Tag})", tag);
            return new ObjectResult(new { message = $"{ex.GetType().Name}: {ex.Message}" })
            {
                StatusCode = StatusCodes.Status500InternalServerError,
            };
        }
    }
}
