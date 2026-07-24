using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Dtos.BulkImport.Templates;
using RoutedOperations.Core.Application.Services.BulkImport;
using Serilog;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Templates controller (Pass C port of BulkImportHyper's TemplatesController).
/// Manages per-contact CSV column-mapping templates used by Step 2 of the
/// Bulk Import wizard. Ownership is enforced inside TemplateService by the
/// ContactId filter on every read/write; the controller only surfaces the
/// three CRUD endpoints and gates them behind the same RouteBuilder.Admin
/// policy every other bulk-import endpoint uses.
/// </summary>
[ApiController]
[Route("api/templates")]
[Authorize(Policy = "RouteBuilder.Admin")]
public class TemplatesController(
    TemplateService templateService,
    ILogger<TemplatesController> logger) : BaseController
{
    // Same helper as BulkImportController - the shared cookie stamps
    // "ContactID" (tucClientContact PK); everything downstream keys off that.
    private int GetCurrentContactId()
    {
        var raw = User?.FindFirstValue("ContactID");
        return int.TryParse(raw, out var id) ? id : 0;
    }

    // Local bulk-response wrapper. The inherited BaseController.HandleResponse
    // is typed against the sibling BaseResponse in Dtos.Common (different
    // namespace), so we duplicate the "success=200 otherwise 400" contract
    // here to keep the response shape parity with BulkImportController.
    private IActionResult HandleBulkResponse(BaseResponse response)
    {
        Log.Information("Response ({MessageId})({ContactId}): Success={Success}",
            response.MessageId, GetCurrentContactId(), response.Success);
        return response.Success ? Ok(response) : BadRequest(response);
    }

    private IActionResult HandleBulkInvalidModelState(System.Guid messageId)
    {
        var response = new BaseResponse(messageId);
        var messages = ModelState
            .SelectMany(kv => kv.Value!.Errors.Select(e => new MessageDto { Message = e.ErrorMessage }));
        response.Messages.AddRange(messages);
        Log.Warning("Response ({MessageId})({ContactId}): {Response}",
            response.MessageId, GetCurrentContactId(), JsonConvert.SerializeObject(response));
        return BadRequest(response);
    }

    // GET /api/templates - list all templates owned by the current contact.
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        try
        {
            var messageId = System.Guid.NewGuid();
            Log.Information("({Method} {Path})({ContactId})({MessageId})",
                Request.Method, Request.Path, GetCurrentContactId(), messageId);
            return HandleBulkResponse(await templateService.Get(messageId, GetCurrentContactId()));
        }
        catch (System.Exception e)
        {
            logger.LogError(e, "Templates.Get failed");
            throw;
        }
    }

    // POST /api/templates - create a template + its mappings.
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] TemplateCreateRequest request)
    {
        try
        {
            Log.Information("({Method} {Path})({ContactId})({MessageId})",
                Request.Method, Request.Path, GetCurrentContactId(), request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await templateService.Create(GetCurrentContactId(), request));
        }
        catch (System.Exception e)
        {
            logger.LogError(e, "Templates.Create failed");
            throw;
        }
    }

    // DELETE /api/templates/{id} - delete a template. Ownership is enforced
    // by TemplateService (the ContactId filter on the FirstOrDefaultAsync
    // returns null for another contact's row, and the service replies
    // "Template not found." rather than 404 to avoid leaking existence).
    [HttpDelete("{Id}")]
    public async Task<IActionResult> Delete([FromRoute] IdRequest request)
    {
        try
        {
            Log.Information("({Method} {Path})({ContactId})({MessageId})",
                Request.Method, Request.Path, GetCurrentContactId(), request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await templateService.Delete(GetCurrentContactId(), request));
        }
        catch (System.Exception e)
        {
            logger.LogError(e, "Templates.Delete failed");
            throw;
        }
    }
}
