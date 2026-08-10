// Route Viewer report endpoints. Reports return CSV (Content-Type
// text/csv) for browser download. Woop XLSX + Linehaul remain 501
// scaffolds - both are Section Z-gated (NZ-only hardcoded IDs).
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/reports")]
[Authorize(Policy = "RouteViewer.Admin")]
public class RunViewerReportController(
    RouteViewerReportService reportService) : BaseController
{
    /// <summary>GET /api/runviewer/reports/run-allocation - CSV.</summary>
    [HttpGet("run-allocation")]
    public Task<IActionResult> GetRunAllocation([FromQuery] ReportRequest request) =>
        CsvReport(reportService.GetRunAllocationCsvAsync(request), "run-allocation", request.RunDate);

    /// <summary>GET /api/runviewer/reports/missing-scan - CSV.</summary>
    [HttpGet("missing-scan")]
    public Task<IActionResult> GetMissingScan([FromQuery] ReportRequest request) =>
        CsvReport(reportService.GetMissingScanCsvAsync(request), "missing-scan", request.RunDate);

    /// <summary>GET /api/runviewer/reports/missing-run-scan - CSV.</summary>
    [HttpGet("missing-run-scan")]
    public Task<IActionResult> GetMissingRunScan([FromQuery] ReportRequest request) =>
        CsvReport(reportService.GetMissingRunScanCsvAsync(request), "missing-run-scan", request.RunDate);

    /// <summary>GET /api/runviewer/reports/missing-transit-scan - CSV.</summary>
    [HttpGet("missing-transit-scan")]
    public Task<IActionResult> GetMissingTransitScan([FromQuery] ReportRequest request) =>
        CsvReport(reportService.GetMissingTransitScanCsvAsync(request), "missing-transit-scan", request.RunDate);

    /// <summary>GET /api/runviewer/reports/woop-run-number - XLSX
    /// (NZ-only per Section Z, hardcoded ucclGroupID=16867).</summary>
    [HttpGet("woop-run-number")]
    public IActionResult GetWoopRunNumber([FromQuery] ReportRequest request) => NotImplemented(
        "Woop XLSX report is Section Z-gated (hardcoded NZ ucclGroupID). Awaiting stakeholder decision.");

    /// <summary>GET /api/runviewer/reports/linehaul - CSV (NZ-only per
    /// Section Z, hardcoded 18 speed IDs).</summary>
    [HttpGet("linehaul")]
    public IActionResult GetLinehaulReport([FromQuery] ReportRequest request) => NotImplemented(
        "Linehaul CSV is Section Z-gated (hardcoded NZ speed IDs). Awaiting stakeholder decision.");

    private async Task<IActionResult> CsvReport(Task<byte[]> generator, string prefix, DateTime? runDate)
    {
        try
        {
            var bytes = await generator;
            var stamp = (runDate ?? DateTime.Today).ToString("yyyy-MM-dd");
            var filename = $"{prefix}-{stamp}.csv";
            return File(bytes, "text/csv", filename);
        }
        catch (NotImplementedException ex)
        {
            return NotImplemented(ex.Message);
        }
    }

    private IActionResult NotImplemented(string message) => StatusCode(
        StatusCodes.Status501NotImplemented,
        new { message });
}
