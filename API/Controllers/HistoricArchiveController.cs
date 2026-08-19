// Historic Archive Upload endpoints. Gate: Internal claim (spec section
// "Permissions"). TODO: replace the ad-hoc IsInternal() check with a
// dedicated `Roles.HistoricArchiveUpload` claim / policy once Hub can
// stamp it. Same pattern as BulkImportController.StaffImport - a proper
// [Authorize(Policy = ...)] plus Hub-side claim would be cleaner but is
// not yet plumbed through.

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.HistoricArchive;
using RoutedOperations.Core.Application.Services.HistoricArchive;
using Serilog;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Authorize]
[Route("api/historic-archive")]
public class HistoricArchiveController(HistoricArchiveService service) : BaseController
{
    private int GetContactId()
    {
        var raw = User?.FindFirstValue("ContactID");
        return int.TryParse(raw, out var id) ? id : 0;
    }

    private bool IsInternal()
    {
        var claim = User?.FindFirstValue("Internal");
        return !string.IsNullOrEmpty(claim)
            && bool.TryParse(claim, out var v)
            && v;
    }

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
