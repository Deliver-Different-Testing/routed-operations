using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Read-side jobs endpoints for the Mapped Stops drill-down + Speed picker.
/// Split from RecurringLinehaulRunsController to keep the run CRUD focused.
/// </summary>
[ApiController]
[Authorize(Policy = "RouteBuilder.Read")]
public class RecurringLinehaulJobsController(RecurringLinehaulJobsService service) : BaseController
{
    // GET /api/recurring-linehaul-runs/{runId}/jobs
    [HttpGet("api/recurring-linehaul-runs/{runId:int}/jobs")]
    public async Task<IActionResult> ListForRun(int runId)
    {
        var list = await service.ListForLinehaulRunAsync(runId);
        return Ok(new { response = list });
    }

    // GET /api/recurring-jobs/{jobId}
    [HttpGet("api/recurring-jobs/{jobId:int}")]
    public async Task<IActionResult> GetDetail(int jobId)
    {
        var dto = await service.GetDetailAsync(jobId);
        return dto is null ? NotFound() : Ok(new { response = dto });
    }

    // PATCH /api/recurring-jobs/{jobId}/speed
    [HttpPatch("api/recurring-jobs/{jobId:int}/speed")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpdateSpeed(int jobId, [FromBody] BulkJobUpdateSpeedRequest req)
    {
        var updated = await service.UpdateSpeedAsync(jobId, req.SpeedId);
        return updated is null ? NotFound() : Ok(new { response = updated });
    }

    // GET /api/speeds/grouped - full ReportingSpeed shape (id, shortName, name,
    // groupingId, groupingName). Reuses the same optgroup + colour data the
    // Configurator's reporting rate-schedule endpoint exposes.
    [HttpGet("api/speeds/grouped")]
    public async Task<IActionResult> GetGroupedSpeeds()
    {
        var list = await service.GetGroupedSpeedsAsync();
        return Ok(new { response = list });
    }
}
