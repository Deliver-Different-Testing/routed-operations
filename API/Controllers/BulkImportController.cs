using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Services.BulkImport;
using Serilog;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Bulk Import direct-insert controller (Phase 1 Task 6 port of
/// BulkImportHyper's BulkController). Routes match the pre-existing
/// `api/bulk-import` surface the React frontend already talks to; the
/// retired shadow-table variant is kept alive under
/// `api/bulk-import-retired` for the cutover window.
///
/// The three services listed in the plan (BulkImportServiceV2 +
/// BulkImportJobFactory + BulkImportRatingService) are all partial-class
/// halves of ONE type - BulkImportServiceV2 - so only one instance is
/// injected. The rate/factory partial's public methods (Import, GetPickupRate,
/// BookPickup) resolve off the same instance.
///
/// All endpoints gated by RouteBuilder.Admin. StaffImport + Google Drive
/// endpoints are Phase 3 stubs returning 501 until the corresponding
/// service methods (StaffImport, ImportFromGoogleDrive is present but
/// intentionally not surfaced here yet).
/// </summary>
[ApiController]
[Route("api/bulk-import")]
[Authorize(Policy = "RouteBuilder.Admin")]
public class BulkImportController(
    BulkImportServiceV2 bulkService,
    ILogger<BulkImportController> logger) : BaseController
{
    // Resolve the tucClientContact PK from the shared-cookie "ContactID"
    // claim Hub issues. Falls back to 0 so downstream services see the
    // same shape they'd get for an unauthenticated (impossible under
    // [Authorize]) or non-staff caller. Kept private + local because no
    // other controller in RoutedOperations currently needs it - the
    // sibling controllers all key off tenant-only claims.
    private int GetCurrentContactId()
    {
        var raw = User?.FindFirstValue("ContactID");
        return int.TryParse(raw, out var id) ? id : 0;
    }

    private void LogRequestStart(Guid messageId)
    {
        Log.Information("({Method} {Path})({ContactId})({MessageId})",
            Request.Method, Request.Path, GetCurrentContactId(), messageId);
    }

    // Local response wrapper. Cannot use the inherited BaseController.HandleResponse
    // because that method is typed against RoutedOperations.Core.Application.Dtos.Common.BaseResponse
    // whereas every BulkImport service returns the sibling type in
    // RoutedOperations.Core.Application.Dtos.BulkImport.Common.BaseResponse
    // (different namespaces, no shared base). Preserves the same
    // "success=200 otherwise 400" contract.
    private IActionResult HandleBulkResponse(BaseResponse response)
    {
        Log.Information("Response ({MessageId})({ContactId}): Success={Success}",
            response.MessageId, GetCurrentContactId(), response.Success);
        return response.Success ? Ok(response) : BadRequest(response);
    }

    private IActionResult HandleBulkInvalidModelState(Guid messageId)
    {
        var response = new BaseResponse(messageId);
        var messages = ModelState
            .SelectMany(kv => kv.Value!.Errors.Select(e => new MessageDto { Message = e.ErrorMessage }));
        response.Messages.AddRange(messages);

        Log.Warning("Response ({MessageId})({ContactId}): {Response}",
            response.MessageId, GetCurrentContactId(), JsonConvert.SerializeObject(response));
        return BadRequest(response);
    }

    // GET /api/bulk-import/jobs - list past routed / on-demand / prebook
    // bulk jobs the current contact can see.
    [HttpGet("jobs")]
    public async Task<IActionResult> GetBulkJobs()
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);
            return HandleBulkResponse(await bulkService.GetBulkJobs(GetCurrentContactId(), messageId));
        }
        catch (Exception e)
        {
            logger.LogError(e, "GetBulkJobs failed");
            throw;
        }
    }

    // POST /api/bulk-import/upload - multipart file upload, returns the
    // parsed grid as a JSON string (List<Dictionary<string, object>>).
    // Returns 400 for a missing / unsupported file, or the raw parse JSON
    // on success so the React grid can rehydrate.
    [HttpPost("upload")]
    public async Task<IActionResult> UploadFile(IFormFile file)
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);

            var result = await bulkService.UploadFile(GetCurrentContactId(), file);

            Log.Information("Response ({MessageId}): Upload success={HasResult}", messageId, !string.IsNullOrWhiteSpace(result));

            if (string.IsNullOrWhiteSpace(result))
                return BadRequest("Invalid file.");
            return Ok(result);
        }
        catch (Exception e)
        {
            logger.LogError(e, "UploadFile failed");
            throw;
        }
    }

    // POST /api/bulk-import/import - main direct-insert flow. Dispatches
    // to ProcessRoutedJobs / ProcessOnDemandJobs in the JobFactory partial
    // depending on the request's booking mode.
    [HttpPost("import")]
    public async Task<IActionResult> Import([FromBody] BulkImportRequest request)
    {
        try
        {
            LogRequestStart(request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await bulkService.Import(GetCurrentContactId(), request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Import failed");
            throw;
        }
    }

    // POST /api/bulk-import/staff-import - NZ internal-staff direct tucJob
    // insert. Auth gate mirrors BulkImportHyper's BulkController.StaffImport:
    // requires Internal claim + CountryCode == NZ, otherwise returns 403
    // rather than 401 (the shared cookie already authenticated the user;
    // they just don't have the internal-staff role). Response body carries
    // the same messageId shape the wizard renders.
    [HttpPost("staff-import")]
    public async Task<IActionResult> StaffImport([FromBody] StaffImportRequest request)
    {
        try
        {
            LogRequestStart(request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);

            var internalClaim = User?.FindFirstValue("Internal");
            var isInternal = !string.IsNullOrEmpty(internalClaim)
                && bool.TryParse(internalClaim, out var internalValue)
                && internalValue;
            if (!isInternal)
            {
                Log.Warning("({MessageId})({ContactId}) Unauthorized staff import attempt by non-internal user.",
                    request.MessageId, GetCurrentContactId());
                var forbidden = new BaseResponse(request.MessageId);
                forbidden.Messages.Add(new MessageDto { Message = "Staff import is only available for internal staff users." });
                return StatusCode(StatusCodes.Status403Forbidden, forbidden);
            }

            // Country gate removed - Staff Import is now supported on both NZ
            // and US tenants (Feature 4). The service partial branches on
            // IsNzTenant() to call the correct SP (INT_stpJob_BulkInsertAsync
            // vs DD_stpJob_InsertExceleratorAsync). Internal claim gate above
            // remains.

            return HandleBulkResponse(await bulkService.StaffImport(GetCurrentContactId(), request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "StaffImport failed");
            throw;
        }
    }

    // POST /api/bulk-import/import-google-drive - fetch a spreadsheet from
    // Google Drive by fileId + accessToken and return the parsed grid in
    // the same JSON-string shape the /upload endpoint returns. The React
    // wizard consumes it via parseUploadResponse for a uniform code path.
    // OAuth token acquisition is the frontend's responsibility - this
    // endpoint just consumes whatever access token the caller supplies.
    [HttpPost("import-google-drive")]
    public async Task<IActionResult> ImportFromGoogleDrive([FromBody] GoogleDriveImportRequest request)
    {
        try
        {
            LogRequestStart(request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await bulkService.ImportFromGoogleDrive(GetCurrentContactId(), request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "ImportFromGoogleDrive failed");
            throw;
        }
    }

    // POST /api/bulk-import/pickup-rate - price a pickup booking without
    // committing it. Used by Step 4 of the wizard for the "rate & confirm"
    // preview.
    [HttpPost("pickup-rate")]
    public async Task<IActionResult> GetPickupRate([FromBody] PickupJobRequest request)
    {
        try
        {
            LogRequestStart(request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await bulkService.GetPickupRate(GetCurrentContactId(), request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "GetPickupRate failed");
            throw;
        }
    }

    // POST /api/bulk-import/book-pickup - actually create the pickup jobs
    // via WS_stpJob_Insert. Fires N inserts for N vehicles.
    [HttpPost("book-pickup")]
    public async Task<IActionResult> BookPickup([FromBody] PickupJobRequest request)
    {
        try
        {
            LogRequestStart(request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await bulkService.BookPickup(GetCurrentContactId(), request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "BookPickup failed");
            throw;
        }
    }

    // DELETE /api/bulk-import/jobs/{id} - remove a routed bulk job the
    // current contact owns. Cascades to child jobs + tblBulkJobRun rows.
    [HttpDelete("jobs/{id}")]
    public async Task<IActionResult> DeleteBulkJob([FromRoute] IdRequest request)
    {
        try
        {
            Log.Information("({Method} {Path}): {Request}", Request.Method, Request.Path, JsonConvert.SerializeObject(request));
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await bulkService.DeleteBulkJob(GetCurrentContactId(), request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "DeleteBulkJob failed");
            throw;
        }
    }

    // DELETE /api/bulk-import/tuc-jobs/{id} - void an on-demand / prebook
    // tucJob and cascade to children. Stamps a "DELETED by <name>" note
    // for audit.
    [HttpDelete("tuc-jobs/{id}")]
    public async Task<IActionResult> DeleteTucJob([FromRoute] IdRequest request)
    {
        try
        {
            Log.Information("({Method} {Path}): {Request}", Request.Method, Request.Path, JsonConvert.SerializeObject(request));
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await bulkService.DeleteTucJob(GetCurrentContactId(), request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "DeleteTucJob failed");
            throw;
        }
    }

    // POST /api/bulk-import/search-for-complete - look up existing routed
    // or on-demand jobs by job number for the Bulk Complete flow.
    [HttpPost("search-for-complete")]
    public async Task<IActionResult> SearchJobsForBulkComplete([FromBody] BulkJobSearchRequest request)
    {
        try
        {
            LogRequestStart(request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await bulkService.SearchJobsForBulkComplete(GetCurrentContactId(), request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "SearchJobsForBulkComplete failed");
            throw;
        }
    }

    // POST /api/bulk-import/bulk-complete - mark the matched jobs complete
    // in one go. Routed jobs go through UTL_stpJob_InsertFromRunBuilder to
    // spawn a shared "BulkImportComplete" run.
    [HttpPost("bulk-complete")]
    public async Task<IActionResult> BulkCompleteJobs([FromBody] BulkJobCompleteRequest request)
    {
        try
        {
            LogRequestStart(request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await bulkService.BulkCompleteJobs(GetCurrentContactId(), request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "BulkCompleteJobs failed");
            throw;
        }
    }
}
