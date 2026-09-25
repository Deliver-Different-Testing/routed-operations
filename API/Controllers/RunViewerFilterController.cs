// Filter-dropdown endpoints for the Route Viewer Home module + Print +
// Linehaul + Scans + CS filter panels. Home fires all 5 on initial load
// (clients + speeds + regions + topup-services + suburbs). Every screen
// refires clients/speeds/regions when the date filter changes; suburbs
// + topup-services stay stable for the session.
//
// Cache candidates in a later perf pass - LookupDto rows are tiny + rarely
// change. Not cached in P1; TenantScopedCache is available if we want to
// layer it in.
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/filters")]
[Authorize(Policy = "RouteViewer.Read")]
public class RunViewerFilterController(
    RouteViewerFilterService filterService) : BaseController
{
    /// <summary>
    /// GET /api/runviewer/filters/clients?runDate=&multipleClients=&contactId=
    /// Client dropdown for the filter panel + client scope switcher.
    /// </summary>
    [HttpGet("clients")]
    public async Task<IActionResult> GetClients(
        [FromQuery] DateTime? runDate,
        [FromQuery] bool multipleClients = false,
        [FromQuery] int? contactId = null)
    {
        var rows = await filterService.GetClientListAsync(runDate, multipleClients, contactId);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/filters/speeds?runDate=</summary>
    [HttpGet("speeds")]
    public async Task<IActionResult> GetSpeeds([FromQuery] DateTime? runDate)
    {
        var rows = await filterService.GetSpeedListAsync(runDate);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/filters/regions?runDate=</summary>
    [HttpGet("regions")]
    public async Task<IActionResult> GetRegions([FromQuery] DateTime? runDate)
    {
        var rows = await filterService.GetRegionListAsync(runDate);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/filters/suburbs - full suburb list
    /// for the GPS-form Select2 picker.</summary>
    [HttpGet("suburbs")]
    public async Task<IActionResult> GetSuburbs()
    {
        var rows = await filterService.GetSuburbListAsync();
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/filters/topup-services - Top Up
    /// service dropdown for the Book Top Up dialog.</summary>
    [HttpGet("topup-services")]
    public async Task<IActionResult> GetTopUpServices()
    {
        var rows = await filterService.GetTopUpListAsync();
        return Ok(new { response = rows });
    }
}
