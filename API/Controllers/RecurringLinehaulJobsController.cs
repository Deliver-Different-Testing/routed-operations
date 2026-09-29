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
    // GET /api/recurring-linehaul-runs/{runId}/jobs?page=1&pageSize=50&search=
    //
    // Paged since Bug 3: the union of the two sources reaches 9,274 non-void
    // stops on the largest urgent-prod run, and the drill-down renders every
    // returned row. Omitting the params gives page 1 at the default size, and the
    // service clamps pageSize to 200. `search` filters on job number server-side,
    // before paging.
    [HttpGet("api/recurring-linehaul-runs/{runId:int}/jobs")]
    public async Task<IActionResult> ListForRun(
        int runId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 0,
        [FromQuery] string? search = null)
    {
        var result = await service.ListForLinehaulRunAsync(runId, page, pageSize, search);
        return Ok(new { response = result });
    }

    // GET /api/recurring-jobs/{jobId}?source=bulk|tuc|archive
    //
    // Bug 3: jobId alone is ambiguous now that the list unions three tables, so
    // the row's source travels with it. Omitting source resolves to "bulk",
    // which is what every caller written before Bug 3 meant.
    [HttpGet("api/recurring-jobs/{jobId:int}")]
    public async Task<IActionResult> GetDetail(int jobId, [FromQuery] string? source = null)
    {
        var dto = await service.GetDetailAsync(jobId, source);
        return dto is null ? NotFound() : Ok(new { response = dto });
    }

    // PATCH /api/recurring-jobs/{jobId}/speed?source=bulk|tuc
    [HttpPatch("api/recurring-jobs/{jobId:int}/speed")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpdateSpeed(
        int jobId, [FromBody] BulkJobUpdateSpeedRequest req, [FromQuery] string? source = null)
    {
        var updated = await service.UpdateSpeedAsync(jobId, req.SpeedId, source);
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
