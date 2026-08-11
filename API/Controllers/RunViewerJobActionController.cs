// Route Viewer job-action REST surface. All job-status mutations
// (activate / pickup / missing / complete / lmc / release / transfer /
// send-sms / cancel / move-back / add-note) live here so
// RunViewerJobController stays a pure read surface.
//
// URL scheme: `/api/runviewer/jobs/{action}` (POST). Bodies map 1:1
// with JobActionRequests.cs. Every write is `RouteViewer.Admin`
// policy - NP-scoped operators cannot mutate jobs through this
// controller (NP has its own courier-scoped action surface on the
// existing AssignmentController).
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/jobs")]
[Authorize(Policy = "RouteViewer.Admin")]
public class RunViewerJobActionController(
    RouteViewerJobActionService actions) : BaseController
{
    [HttpPost("activate")]
    public Task<IActionResult> Activate([FromBody] JobActionRequest r) =>
        Run(() => actions.ActivateAsync(r.JobId));

    [HttpPost("pickup")]
    public Task<IActionResult> Pickup([FromBody] JobActionRequest r) =>
        Run(() => actions.PickupAsync(r.JobId));

    [HttpPost("missing")]
    public Task<IActionResult> Missing([FromBody] JobActionRequest r) =>
        Run(() => actions.MissingAsync(r.JobId));

    [HttpPost("complete")]
    public Task<IActionResult> Complete([FromBody] CompleteJobRequest r) =>
        Run(() => actions.CompleteAsync(r.JobId, r.PodName, r.CompletedTime));

    [HttpPost("lmc")]
    public Task<IActionResult> Lmc([FromBody] LmcJobRequest r) =>
        Run(() => actions.LmcAsync(r.JobId, r.BulkJobId, r.FromCourierCode));

    [HttpPost("release")]
    public Task<IActionResult> Release([FromBody] JobActionRequest r) =>
        Run(() => actions.ReleaseAsync(r.JobId));

    [HttpPost("transfer-courier")]
    public Task<IActionResult> TransferCourier([FromBody] TransferJobRequest r) =>
        Run(() => actions.TransferJobAsync(r.JobId, r.FromCourierCode, r.ToCourierCode));

    [HttpPost("send-sms")]
    public Task<IActionResult> SendSms([FromBody] SendSmsRequest r) =>
        Run(() => actions.SendSmsAsync(r.JobId, r.Mobile, r.Message));

    [HttpPost("send-sms-run")]
    public Task<IActionResult> SendSmsRun([FromBody] SendSmsRunRequest r) =>
        Run(() => actions.SendSmsToRunAsync(r.RunId, r.Message));

    [HttpPost("cancel")]
    public Task<IActionResult> Cancel([FromBody] BulkJobActionRequest r) =>
        Run(() => actions.CancelJobsAsync(r.BulkJobIds));

    [HttpPost("move-back-to-runbuilder")]
    public Task<IActionResult> MoveBack([FromBody] MoveJobsBackToRunBuilderRequest r) =>
        Run(() => actions.MoveJobsBackToRunBuilderAsync(r.BulkJobIds, r.NewDateTime, r.NewSpeed, r.Void));

    [HttpPost("add-note")]
    public Task<IActionResult> AddJobNote([FromBody] AddJobNoteRequest r) =>
        Run(() => actions.AddJobNoteAsync(r.JobId, r.Notes));

    [HttpPost("add-bulk-note")]
    public Task<IActionResult> AddBulkNote([FromBody] AddBulkJobNoteRequest r) =>
        Run(() => actions.AddBulkJobNoteAsync(r.BulkJobId, r.Notes));

    /// <summary>Click-to-edit patch for text-field surface on the
    /// Detail pane. Body is a partial - server preserves unmentioned
    /// fields. See UpdateTextFieldsAsync for the SP round-trip.</summary>
    [HttpPost("{bulkJobId:int}/text-fields")]
    public Task<IActionResult> UpdateTextFields(int bulkJobId, [FromBody] UpdateJobTextFieldsRequest r) =>
        Run(() => actions.UpdateTextFieldsAsync(bulkJobId, r));

    /// <summary>Update pickup OR delivery address + lat/lng. Body's
    /// `leg` field ("pickup" | "delivery") selects the target SP.</summary>
    [HttpPost("gps")]
    public Task<IActionResult> UpdateGps([FromBody] UpdateJobGpsRequest r) =>
        Run(() => actions.UpdateGpsAsync(r));

    // Shared try/catch wrapper - every action returns 200 { response:
    // "ok" } on success + 403 NpLabelScopeException / 400 on validation
    // failure. Keeps each endpoint one line.
    private async Task<IActionResult> Run(Func<Task> fn)
    {
        try
        {
            await fn();
            return Ok(new { response = "ok" });
        }
        catch (NpLabelScopeException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
