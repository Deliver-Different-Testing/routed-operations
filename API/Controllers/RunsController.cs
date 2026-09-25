using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Application.Services.Run;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Run life cycle. Read-side listing lifts UTL_stpJob_tblBulkRunWithFilter to
/// EF LINQ; CRUD and job-move lift the other legacy SPs to EF too. Dispatch
/// (send-to-live) stays on the RunCommitService's SP wrapper for safety.
/// </summary>
[ApiController]
[Route("api/runs")]
[Authorize(Policy = "RouteBuilder.Read")]
public class RunsController(
    RunService runService,
    RunCommitService runCommitService) : BaseController
{
    // GET /api/runs?date=&clientIds=&regionIds=&ourRefs=&speeds=
    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] DateTime? date,
        [FromQuery] string? clientIds,
        [FromQuery] string? regionIds,
        [FromQuery] string? ourRefs,
        [FromQuery] string? speeds)
    {
        var runs = await runService.GetBulkRunsAsync(date, clientIds, regionIds, ourRefs, speeds);
        return Ok(new { response = runs, MaxJsonLength = int.MaxValue });
    }

    // POST /api/runs               body: InsertOrUpdateRunRequest
    [HttpPost]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> InsertOrUpdate([FromBody] InsertOrUpdateRunRequest body)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        var (result, message) = await runService.InsertOrUpdateRunAsync(body);
        return Ok(new { response = new { Result = result, Message = message } });
    }

    // PUT /api/runs/{id}           body: InsertOrUpdateRunRequest
    [HttpPut("{id:int}")]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> Update(int id, [FromBody] InsertOrUpdateRunRequest body)
    {
        body.Id = id;
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        var (result, message) = await runService.UpdateRunAsync(body);
        return Ok(new { response = new { Result = result, Message = message } });
    }

    // DELETE /api/runs/{id}
    [HttpDelete("{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var (result, message) = await runService.DeleteAsync(id);
        return Ok(new { response = new { Result = result, Message = message } });
    }

    // POST /api/runs/{runId}/assign     body: UpdateJobToRunRequest
    [HttpPost("{runId:int}/assign")]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> AssignJob(int runId, [FromBody] UpdateJobToRunRequest body)
    {
        body.RunId = runId;
        var (result, message) = await runService.UpdateJobToRunAsync(body.JobId, body.FromRunId, body.RunId);
        return Ok(new { response = new { Result = result, Message = message } });
    }

    // DELETE /api/runs/jobs/{jobId}
    [HttpDelete("jobs/{jobId:int}")]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> RemoveJob(int jobId)
    {
        var (result, message) = await runService.RemoveJobFromRunAsync(jobId);
        return Ok(new { response = new { Result = result, Message = message } });
    }

    // POST /api/runs/{runId}/jobs/{jobId}/start-end   body: SetJobStartEndRequest
    [HttpPost("{runId:int}/jobs/{jobId:int}/start-end")]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> SetJobStartEnd(int runId, int jobId, [FromBody] SetJobStartEndRequest body)
    {
        var (result, message) = await runService.SetJobStartEndAsync(runId, jobId, body.IsStart, body.IsEnd);
        return Ok(new { response = new { Result = result, Message = message } });
    }

    // POST /api/runs/dispatch     body: DispatchRunsRequest
    // Send-to-live: wraps UTL_stpJob_InsertFromRunBuilder via Dapper (see RunCommitService).
    [HttpPost("dispatch")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Dispatch([FromBody] DispatchRunsRequest body)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        var results = await runCommitService.DispatchAsync(body.Runs);
        return Ok(new { response = results });
    }

    // POST /api/runs/dispatch-jobs   body: DispatchJobsRequest
    // Send-selected variant: dispatch a flat list of job ids without needing
    // a locked run first. Legacy analogue: sendSelectedJobsToLive.
    [HttpPost("dispatch-jobs")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DispatchJobs([FromBody] DispatchJobsRequest body)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        if (body.JobIds.Count == 0) return Ok(new { response = Array.Empty<object>() });
        var results = await runCommitService.DispatchJobsAsync(body);
        return Ok(new { response = results });
    }
}
