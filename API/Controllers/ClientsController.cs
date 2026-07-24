using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.BulkImport.Clients;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Services.BulkImport;
using Serilog;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Phase 1 Task 6 port of BulkImportHyper's ClientsController. Powers the
/// client dropdown / typeahead in Step 1 of the Bulk Import wizard plus the
/// per-client settings, schedules, and job-number-sequencer endpoints the
/// downstream steps rely on.
///
/// Every endpoint runs under RouteBuilder.Admin. Row-level scoping to the
/// caller's tucClientContact assignments happens inside ClientService itself
/// so the controller stays a thin dispatcher.
/// </summary>
[ApiController]
[Route("api/clients")]
[Authorize(Policy = "RouteBuilder.Admin")]
public class ClientsController(
    ClientService clientService,
    ILogger<ClientsController> logger) : BaseController
{
    // ContactID claim resolution mirrors BulkImportController. Kept
    // duplicated (rather than pushed onto BaseController) because most
    // sibling controllers don't need it and the BulkImport controllers
    // may retire independently of the others.
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

    // GET /api/clients - clients the current contact is assigned to.
    // Internal staff receive an empty list here + are expected to use
    // /search instead (ClientService.Get encodes that policy).
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);
            return HandleBulkResponse(await clientService.Get(messageId, GetCurrentContactId()));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Clients.Get failed");
            throw;
        }
    }

    // GET /api/clients/search?search=... - typeahead. Frontend enforces
    // a 3-char minimum but the service does not, so a shorter query still
    // returns up to 20 matches (contact-scoped for external users, cross-
    // client for internal staff).
    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string search)
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);
            return HandleBulkResponse(await clientService.Search(messageId, GetCurrentContactId(), search ?? string.Empty));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Clients.Search failed");
            throw;
        }
    }

    // GET /api/clients/{id}/settings - full client bundle (speeds,
    // schedules, stock sizes, contacts). Feeds the Step 2 config panel.
    [HttpGet("{id}/settings")]
    public async Task<IActionResult> GetClientSettings([FromRoute] int id)
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);
            return HandleBulkResponse(await clientService.GetSettings(messageId, GetCurrentContactId(), id));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Clients.GetSettings failed");
            throw;
        }
    }

    // GET /api/clients/{ClientId}/schedules/{BookDate}/{SpeedId}/{depotId}
    // Route casing preserved exactly (mixed camel/pascal) so the React
    // frontend's URL builder keeps matching without a translation shim.
    // The [FromRoute] binder maps each segment onto the corresponding
    // SchedulesByBookDateRequest property by name.
    [HttpGet("{ClientId}/schedules/{BookDate}/{SpeedId}/{depotId}")]
    public async Task<IActionResult> GetSchedulesByBookDate([FromRoute] SchedulesByBookDateRequest request)
    {
        try
        {
            LogRequestStart(request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await clientService.GetSchedulesByBookDate(GetCurrentContactId(), request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Clients.GetSchedulesByBookDate failed");
            throw;
        }
    }

    // GET /api/clients/{jobNumberId} - increments and returns the next
    // job number for a client's job-number-sequence config. Called by the
    // booking flow when creating on-demand pickups. Keep this endpoint
    // AFTER the more specific /{id}/settings and /{ClientId}/schedules/...
    // routes above; ASP.NET's attribute routing prefers static prefixes
    // over pure parameter routes when both match.
    [HttpGet("{jobNumberId}")]
    public async Task<IActionResult> GetJobNumber([FromRoute] JobNumberRequest request)
    {
        try
        {
            LogRequestStart(request.MessageId);
            return HandleBulkResponse(await clientService.GetJobNumber(request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Clients.GetJobNumber failed");
            throw;
        }
    }
}
