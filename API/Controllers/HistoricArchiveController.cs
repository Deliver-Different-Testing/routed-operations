// Historic Archive Upload endpoints. A DFRNT-staff tool.
//
// Gate: the ro-historic-archive Access Control switch, seeded for DF Admin
// (ClientTypeId 5) only (Routed Ops switches spec section 1; Garry confirmed
// 2026-10-12 that tenant staff lose it). [RequireFeature] decides; DF Admin
// bypasses the switches, and any other client type is refused unless DF Admin
// grants them the switch in Access Control.
//
// IsInternal() below is the older staff check (ClientTypeId 4/5), kept as a
// second line: it can only refuse, never widen what the switch allows.

using System.Security.Claims;
using DeliverDifferent.AccessControl.Authorization;
using DeliverDifferent.AccessControl;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.HistoricArchive;
using RoutedOperations.Core.Application.Services.HistoricArchive;
using Serilog;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Authorize]
[Route("api/historic-archive")]
// Access Control switch, DF Admin only by seed (Routed Ops switches spec step 3b).
[RequireFeature("ro-historic-archive")]
public class HistoricArchiveController(HistoricArchiveService service) : BaseController
{
    private int GetContactId()
    {
        var raw = User?.FindFirstValue("ContactID");
        return int.TryParse(raw, out var id) ? id : 0;
    }

    // Staff by ClientTypeId 4/5, not the Hub "Internal" claim: that is the
    // ucclInternal billing flag and carries no permission (Steve 2026-10-08).
    // The narrowing to DF Admin is the [RequireFeature] switch on the class.
    private bool IsInternal() => User is not null && CallerLane.IsStaff(User);

    private IActionResult Forbidden(string message) =>
        StatusCode(StatusCodes.Status403Forbidden, new { message });

    private void LogRequest(Guid messageId) =>
        Log.Information("({Method} {Path})({ContactId})({MessageId})",
            Request.Method, Request.Path, GetContactId(), messageId);

    // POST /api/historic-archive/upload - multipart. Returns parsed grid
    // plus canonical + required field lists for the wizard's map-columns
    // step. No DB writes.
    [HttpPost("upload")]
    public async Task<IActionResult> Upload(IFormFile? file)
    {
        var messageId = Guid.NewGuid();
        LogRequest(messageId);
        if (!IsInternal()) return Forbidden("Historic archive upload is only available for internal staff.");

        try
        {
            var payload = await service.ParseUploadAsync(file);
            Log.Information("({MessageId}) Upload parsed {Rows} rows from {FileName}",
                messageId, payload.Rows.Count, payload.FileName);
            return Ok(payload);
        }
        catch (InvalidOperationException ex)
        {
            Log.Warning(ex, "({MessageId}) Upload rejected: {Message}", messageId, ex.Message);
            return BadRequest(new { message = ex.Message });
        }
    }

    // POST /api/historic-archive/commit - JSON. Writes N rows into
    // tucJobArchive under a transaction plus a HistoricArchiveImportBatch
    // audit row. Returns per-row errors + batch id + contiguous id range.
    [HttpPost("commit")]
    public async Task<IActionResult> Commit([FromBody] HistoricArchiveCommitRequest request)
    {
        var messageId = Guid.NewGuid();
        LogRequest(messageId);
        if (!IsInternal()) return Forbidden("Historic archive upload is only available for internal staff.");

        try
        {
            var response = await service.CommitAsync(request, GetContactId());
            Log.Information("({MessageId}) Commit batch={BatchId} inserted={Ok} rejected={Bad}",
                messageId, response.BatchId, response.InsertedCount, response.RejectedCount);
            return Ok(response);
        }
        catch (InvalidOperationException ex)
        {
            Log.Warning(ex, "({MessageId}) Commit rejected: {Message}", messageId, ex.Message);
            return BadRequest(new { message = ex.Message });
        }
    }

    // GET /api/historic-archive/batches?limit=&offset= - audit-trail list.
    [HttpGet("batches")]
    public async Task<IActionResult> GetBatches([FromQuery] int limit = 50, [FromQuery] int offset = 0)
    {
        var messageId = Guid.NewGuid();
        LogRequest(messageId);
        if (!IsInternal()) return Forbidden("Historic archive upload is only available for internal staff.");
        return Ok(await service.GetBatchesAsync(limit, offset));
    }

    // GET /api/historic-archive/batches/{id} - single batch detail.
    [HttpGet("batches/{id:int}")]
    public async Task<IActionResult> GetBatch(int id)
    {
        var messageId = Guid.NewGuid();
        LogRequest(messageId);
        if (!IsInternal()) return Forbidden("Historic archive upload is only available for internal staff.");
        var dto = await service.GetBatchAsync(id);
        return dto == null ? NotFound() : Ok(dto);
    }

    // GET /api/historic-archive/batches/{id}/jobs?limit=&offset= - paged
    // drill-down over the tucJobArchive rows produced by the batch.
    // Empty rows list for all-rejected batches. 404 for unknown ids.
    [HttpGet("batches/{id:int}/jobs")]
    public async Task<IActionResult> GetBatchJobs(int id, [FromQuery] int limit = 50, [FromQuery] int offset = 0)
    {
        var messageId = Guid.NewGuid();
        LogRequest(messageId);
        if (!IsInternal()) return Forbidden("Historic archive upload is only available for internal staff.");
        try
        {
            return Ok(await service.GetBatchJobsAsync(id, limit, offset));
        }
        catch (InvalidOperationException ex)
        {
            Log.Warning(ex, "({MessageId}) GetBatchJobs {Id} rejected: {Message}", messageId, id, ex.Message);
            return NotFound(new { message = ex.Message });
        }
    }
}
