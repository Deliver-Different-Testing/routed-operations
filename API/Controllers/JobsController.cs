using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.Common;
using RoutedOperations.Core.Application.Dtos.Job;
using RoutedOperations.Core.Application.Services.Job;
using Serilog;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Ports every read + write endpoint that used to live on the legacy
/// JobController plus the JobRepository. Dispatch + HD sync live on
/// RunsController so the URL surface reflects the domain split.
/// </summary>
[ApiController]
[Route("api/jobs")]
[Authorize(Policy = "RouteBuilder.Read")]
public class JobsController(
    JobService jobService,
    VoidJobService voidJobService,
    HdJobSyncService hdJobSyncService) : BaseController
{
    // GET /api/jobs?date=&clientIds=&regionIds=&ourRefs=&speeds=
    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] DateTime? date,
        [FromQuery] string? clientIds,
        [FromQuery] string? regionIds,
        [FromQuery] string? ourRefs,
        [FromQuery] string? speeds)
    {
        var jobs = await jobService.GetBulkJobsAsync(date, clientIds, regionIds, ourRefs, speeds);
        return Ok(new { BulkJobs = jobs, MaxJsonLength = int.MaxValue });
    }

    // GET /api/jobs/filters/clients
    [HttpGet("filters/clients")]
    public async Task<IActionResult> GetClientFilters()
    {
        var clients = await jobService.GetClientFiltersAsync();
        return Ok(new { response = new { clients } });
    }

    // GET /api/jobs/filters/refs?runDate=
    [HttpGet("filters/refs")]
    public async Task<IActionResult> GetOurRefs([FromQuery] DateTime runDate)
    {
        var refs = await jobService.GetOurRefsAsync(runDate);
        return Ok(new { OurRefs = refs });
    }

    // GET /api/jobs/{id}/multibox-children
    [HttpGet("{id:int}/multibox-children")]
    public async Task<IActionResult> GetMultiboxChildren(int id)
    {
        var childIds = await jobService.GetMultiboxChildrenAsync(id);
        return Ok(new { response = childIds });
    }

    // GET /api/jobs/{id}/detail - lazy-loads the 5 heavy display-only fields
    // (Notes + tracking + POD email/mobile) that were dropped from the list
    // projection for perf. Called on JobDetail modal open.
    [HttpGet("{id:int}/detail")]
    public async Task<IActionResult> GetDetail(int id)
    {
        var extras = await jobService.GetJobDetailExtrasAsync(id);
        if (extras == null) return NotFound();
        return Ok(extras);
    }

    // PATCH /api/jobs/{id}         body: { field, value }
    [HttpPatch("{id:int}")]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> UpdateDetail(int id, [FromBody] UpdateJobDetailRequest body)
    {
        body.JobId = id;
        var messageId = Guid.NewGuid();
        Log.Information("({Method} {Path} {MessageId}): {Body}",
            Request.Method, Request.Path, messageId, JsonConvert.SerializeObject(body));

        var ok = await jobService.UpdateJobDetailAsync(id, body.Field, body.Value);
        return Ok(new { response = ok ? "Success" : "Failed" });
    }

    // PATCH /api/jobs/{id}/gps     body: { address, lat, lng, postCode }
    [HttpPatch("{id:int}/gps")]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> UpdateGps(int id, [FromBody] UpdateGpsRequest body)
    {
        body.JobId = id;
        var ok = await jobService.UpdateGpsAsync(body);
        return Ok(new { response = ok ? "Success" : "Failed" });
    }

    // POST /api/jobs/bulk-move     body: BulkUpdateRouteDateRequest
    [HttpPost("bulk-move")]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> BulkMove([FromBody] BulkUpdateRouteDateRequest body)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        var result = await jobService.BulkUpdateRouteDateAsync(body);
        return Ok(new { response = result });
    }

    // POST /api/jobs/void          body: VoidJobsRequest
    [HttpPost("void")]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> Void([FromBody] VoidJobsRequest body)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        var result = await voidJobService.VoidAsync(body);
        return Ok(new { response = result });
    }

    // POST /api/jobs/sync-hd?runDate=
    [HttpPost("sync-hd")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> SyncHd([FromQuery] DateTime runDate)
    {
        var (result, message) = await hdJobSyncService.SyncAsync(runDate);
        return Ok(new { response = new { Result = result, Message = message } });
    }
}
