using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.Diagnostics;
using RoutedOperations.Core.Application.Services.Diagnostics;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Read-only diagnostic feed over dbo.RouteAutoAssignLog. Backs the
/// Auto-Assign Log page under `/auto-assign-log`, itself a follow-up on
/// Steve's dispatch redesign spec 2026-08-03 (visibility for resolver
/// decisions during troubleshooting).
/// </summary>
[ApiController]
[Route("api/diagnostics/auto-assign-log")]
[Authorize(Policy = "RouteBuilder.Polygon")]
public class AutoAssignLogController(AutoAssignLogService svc) : BaseController
{
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] RouteAutoAssignLogQuery query)
    {
        var page = await svc.GetLogAsync(query);
        return Ok(new { response = page });
    }

    /// <summary>Steve spec §827 diagnostic item #1 - active recurring
    /// booking templates on routed speeds that still have RouteId = NULL.
    /// Populates the "Unresolved Recurring Bookings" tab on the same page.</summary>
    [HttpGet("unresolved-recurring-bookings")]
    public async Task<IActionResult> GetUnresolvedRecurringBookings(
        [FromQuery] UnresolvedRecurringBookingQuery query)
    {
        var page = await svc.GetUnresolvedRecurringBookingsAsync(query);
        return Ok(new { response = page });
    }
}
