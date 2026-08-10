// Customer Service event read endpoints under /api/runviewer/events/*.
// T.1 SECURITY: NP sessions short-circuit to empty on EventList +
// EventJobs (interim fix pending tblBulkEvent NpAgentId backfill).
//
// GetBulkJob + GetBulkJobPhotos are on RunViewerJobController; CS
// module consumes them the same way Home Detail does.
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/events")]
[Authorize(Policy = "RouteViewer.Read")]
public class RunViewerEventController(
    RouteViewerEventService eventService) : BaseController
{
    /// <summary>GET /api/runviewer/events - event list for the CS
    /// grid. NP short-circuits to empty per T.1 interim.</summary>
    [HttpGet]
    public async Task<IActionResult> GetEventList([FromQuery] EventListRequest request)
    {
        var rows = await eventService.GetEventListAsync(request);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/events/jobs?clientId=&clientInternal=
    /// - job typeahead for the create-event dialog.</summary>
    [HttpGet("jobs")]
    public async Task<IActionResult> GetEventJobs(
        [FromQuery] int? clientId,
        [FromQuery] bool clientInternal = false)
    {
        var rows = await eventService.GetEventJobsAsync(clientId, clientInternal);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/runviewer/events/direct-link?eventId=&clientId=
    /// - signed URL for external clients.</summary>
    [HttpGet("direct-link")]
    public async Task<IActionResult> GenerateDirectLink(
        [FromQuery] int eventId,
        [FromQuery] int clientId)
    {
        var link = await eventService.GenerateDirectLinkAsync(eventId, clientId);
        return Ok(new { response = link });
    }
}
