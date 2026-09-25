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

    /// <summary>POST /api/runviewer/events - create a CS event.
    /// Returns the new BulkEventID.</summary>
    [HttpPost]
    public async Task<IActionResult> CreateEvent([FromBody] CreateEventRequest request)
    {
        var id = await eventService.CreateEventAsync(request);
        return Ok(new { response = new { bulkEventId = id } });
    }

    /// <summary>POST /api/runviewer/events/client-intel - create or
    /// update a client-intel row (metadata only for now; file upload
    /// wires with the CS module).</summary>
    [HttpPost("client-intel")]
    public async Task<IActionResult> CreateClientIntel([FromBody] ClientIntelRequest request)
    {
        await eventService.CreateClientIntelAsync(request);
        return Ok(new { response = "ok" });
    }

    /// <summary>POST /api/runviewer/events/{eventId}/close -
    /// close a CS event. Sets ClosedDate + ClosedByName via EF.</summary>
    [HttpPost("{eventId:int}/close")]
    public async Task<IActionResult> CloseEvent(int eventId, [FromBody] CloseEventRequest request)
    {
        var ok = await eventService.CloseEventAsync(eventId, request.ClosedBy ?? "unknown");
        if (!ok) return NotFound(new { message = "Event not found or NP-scoped." });
        return Ok(new { response = "ok" });
    }

    /// <summary>POST /api/runviewer/events/{eventId}/reply - prepend
    /// a note to the event's Notes field (thread-style, matches
    /// legacy CS AddEventNote behaviour).</summary>
    [HttpPost("{eventId:int}/reply")]
    public async Task<IActionResult> AddReply(int eventId, [FromBody] AddEventReplyRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Note))
            return BadRequest(new { message = "Note is required." });
        var ok = await eventService.AddEventReplyAsync(eventId, request.Note, request.UserName ?? "unknown");
        if (!ok) return NotFound(new { message = "Event not found or NP-scoped." });
        return Ok(new { response = "ok" });
    }

    /// <summary>POST /api/runviewer/events/client-intel/photo - upload
    /// a client-intel photo to S3. Key convention:
    /// `{mobile}-ClientIntel-{yyyyMMddHHmmss}`.</summary>
    [HttpPost("client-intel/photo")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<IActionResult> UploadIntelPhoto(
        [FromForm] IFormFile file,
        [FromForm] string mobile,
        [FromForm] string? description = null,
        [FromServices] S3PhotoReader s3 = null!)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "file is required." });
        if (string.IsNullOrWhiteSpace(mobile))
            return BadRequest(new { message = "mobile is required." });
        try
        {
            using var stream = file.OpenReadStream();
            var key = await s3.UploadClientIntelPhotoAsync(mobile, stream, file.ContentType ?? "image/jpeg", description);
            return Ok(new { response = new { key } });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(501, new { message = ex.Message });
        }
    }

    /// <summary>DELETE /api/runviewer/events/client-intel/photo?key=
    /// - delete a client-intel photo by S3 key.</summary>
    [HttpDelete("client-intel/photo")]
    public async Task<IActionResult> DeleteIntelPhoto(
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
}
