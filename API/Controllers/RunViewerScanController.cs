// Scan Manager read endpoints under /api/runviewer/scans/*. Home
// module's below-map Scan Detail panel + Scan Manager module (Bulk +
// Routed modes) both consume from here.
//
// Bulk grid short-circuits to empty for NP sessions (Section 1). Routed
// grid + item-progress + shipment-detail are NP-scoped via @NpAgentId
// inside the SPs.
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/scans")]
[Authorize(Policy = "RouteViewer.Read")]
public class RunViewerScanController(
    RouteViewerScanService scanService) : BaseController
{
    /// <summary>GET /api/runviewer/scans - Bulk-mode grid.</summary>
    [HttpGet]
    public async Task<IActionResult> GetBulkScanJobs([FromQuery] BulkRunListRequest request)
    {
        var rows = await scanService.GetBulkScanJobsAsync(request);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/scans/routed - Routed-mode grid.
    /// US default; NZ default is Bulk. Frontend toggle switches.</summary>
    [HttpGet("routed")]
    public async Task<IActionResult> GetRoutedScanJobs([FromQuery] BulkRunListRequest request)
    {
        var rows = await scanService.GetRoutedScanJobsAsync(request);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/scans/routed-detail?rootJobId=&runDate=
    /// Full routed shipment drawer (dead-code fallback per Section Z;
    /// endpoint kept in case the drawer is re-wired later).</summary>
    [HttpGet("routed-detail")]
    public async Task<IActionResult> GetRoutedShipmentDetail(
        [FromQuery] int rootJobId,
        [FromQuery] DateTime? runDate)
    {
        var detail = await scanService.GetRoutedShipmentDetailAsync(rootJobId, runDate);
        if (detail == null) return NotFound();
        return Ok(new { response = detail });
    }

    /// <summary>GET /api/runviewer/scans/detail?runDate=&scan=&rootJobId=
    /// Scan Detail panel rows for a selected job.</summary>
    [HttpGet("detail")]
    public async Task<IActionResult> GetScanDetail(
        [FromQuery] DateTime? runDate,
        [FromQuery] string? scan,
        [FromQuery] int? rootJobId)
    {
        var rows = await scanService.GetScanDetailAsync(runDate, scan, rootJobId);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/scans/item-progress?rootJobId= -
    /// per-item leg-track lazy fetch.</summary>
    [HttpGet("item-progress")]
    public async Task<IActionResult> GetItemProgress([FromQuery] int rootJobId)
    {
        var rows = await scanService.GetItemProgressAsync(rootJobId);
        return Ok(new { response = rows });
    }

    /// <summary>POST /api/runviewer/scans/remove-missing - admin bulk
    /// purge of missing-scan LHP / DEL child rows for a run-date +
    /// filter slice. Wraps RVW_stpRemoveMissingScanJobs.</summary>
    [HttpPost("remove-missing")]
    [Authorize(Policy = "RouteViewer.Admin")]
    public async Task<IActionResult> RemoveMissing([FromBody] RemoveMissingScanRequest request)
    {
        var ok = await scanService.RemoveMissingScanJobsAsync(request);
        if (!ok) return Forbid();
        return Ok(new { response = "ok" });
    }
}
