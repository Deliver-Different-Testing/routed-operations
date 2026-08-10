// Route Viewer label endpoints. P1 SCAFFOLD - all methods return 501
// with a clear P14 TODO in the payload. Frontend can wire the URLs
// safely; P14 fills in the actual PDF/CSV generation.
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
    /// tucJob label PDF (Mode 1). SCAFFOLD - returns 501 until P14.</summary>
    [HttpGet("jobs/{jobId:int}")]
    public IActionResult GetSingleJobLabel(int jobId) => NotImplemented();

    /// <summary>GET /api/runviewer/labels/lhp-jobs/{jobId} - LHP single
    /// label (Mode 1, default bulk template). SCAFFOLD.</summary>
    [HttpGet("lhp-jobs/{jobId:int}")]
    public IActionResult GetLhpJobLabel(int jobId) => NotImplemented();

    /// <summary>GET /api/runviewer/labels/bulk?bulkJobId= - single
    /// bulk-label PDF (Mode 2), base64-in-JSON per V7.2 decision.
    /// SCAFFOLD.</summary>
    [HttpGet("bulk")]
    public IActionResult GetSingleBulkLabel([FromQuery] int bulkJobId) => NotImplemented();

    /// <summary>POST /api/runviewer/labels/bulk-jobs - Mode 4 bulk
    /// labels by run (or Mode 8 for routed run). SCAFFOLD.</summary>
    [HttpPost("bulk-jobs")]
    public IActionResult GetBulkLabels([FromBody] LabelRequest request) => NotImplemented();

    /// <summary>POST /api/runviewer/labels/bulk-jobs-by-speed - Mode 5.
    /// SCAFFOLD.</summary>
    [HttpPost("bulk-jobs-by-speed")]
    public IActionResult GetBulkLabelsBySpeed([FromBody] LabelRequest request) => NotImplemented();

    /// <summary>POST /api/runviewer/labels/linehaul-jobs - Mode 6.
    /// NP blocked. SCAFFOLD.</summary>
    [HttpPost("linehaul-jobs")]
    public IActionResult GetLineHaulLabels([FromBody] LabelRequest request) => NotImplemented();

    /// <summary>GET /api/runviewer/labels/linehaul-manifest?... -
    /// CSV export. SCAFFOLD.</summary>
    [HttpGet("linehaul-manifest")]
    public IActionResult GetLineHaulManifest([FromQuery] LabelRequest request) => NotImplemented();

    private IActionResult NotImplemented() => StatusCode(
        StatusCodes.Status501NotImplemented,
        new { message = "Route Viewer label render is P14 (AlertLabel package + SSRS env vars pending). Endpoint contract is stable; wire the URL freely." });
}
