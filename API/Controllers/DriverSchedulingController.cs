// Driver Scheduling controller. Route base `api/driver-scheduling`
// deliberately distinct from the existing `api/schedules`
// (SchedulesController) which owns the booking/prebook schedules -
// two different domains, two different DB neighbourhoods, two
// different sidebar entries.
//
// GETs behind RouteBuilder.Read; writes behind RouteBuilder.Admin
// (Kevin's 2026-09-07 Day-1 decision - no new policy pair needed).
// InvalidOperationException from the service maps to 400 with a
// clean operator-facing message; the DB overbooking trigger's
// translated exception is the one exception to that pattern (still
// 400 today; can be lifted to 409 in a follow-up if UX wants
// distinct treatment).
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.DriverScheduling;
using RoutedOperations.Core.Application.Services.DriverScheduling;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/driver-scheduling")]
public class DriverSchedulingController(DriverSchedulingService svc) : BaseController
{
    // ─── Reads ─────────────────────────────────────────────────────

    /// <summary>GET /api/driver-scheduling/summaries/{bookDate:datetime}
    /// - per-location schedule + timeslot summaries for the given day.
    /// Fuels the Driver Scheduling home page.</summary>
    [HttpGet("summaries/{bookDate:datetime}")]
    [Authorize(Policy = "RouteBuilder.Read")]
    public async Task<IActionResult> GetSummariesByBookDate(DateTime bookDate)
    {
        try
        {
            var rows = await svc.GetSummariesByBookDateAsync(bookDate);
            return Ok(new { response = rows });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>GET /api/driver-scheduling/{id}/couriers - courier
    /// list for a schedule with their response state. Only returns
    /// couriers once the schedule has been notified.</summary>
    [HttpGet("{id:long}/couriers")]
    [Authorize(Policy = "RouteBuilder.Read")]
    public async Task<IActionResult> GetCouriersBySchedule(long id)
    {
        try
        {
            var rows = await svc.GetCouriersByScheduleAsync(id);
            return Ok(new { response = rows });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>GET /api/driver-scheduling/notifications - schedules
    /// that are eligible for notification-send (from today, not yet
    /// started, not yet notified).</summary>
    [HttpGet("notifications")]
    [Authorize(Policy = "RouteBuilder.Read")]
    public async Task<IActionResult> GetNotifications()
    {
        var rows = await svc.GetScheduleNotificationsAsync();
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/driver-scheduling/responses/statuses/{statusId}/couriers
    /// - couriers filtered by response status across every upcoming
    /// schedule. StatusId=0 = "hasn't responded yet".</summary>
    [HttpGet("responses/statuses/{statusId:int}/couriers")]
    [Authorize(Policy = "RouteBuilder.Read")]
    public async Task<IActionResult> GetCouriersByResponseStatus(int statusId)
    {
        var rows = await svc.GetCouriersByResponseStatusAsync(statusId);
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/driver-scheduling/locations - active bulk
    /// regions the operator can pick when creating a schedule. Fuels
    /// the New Schedule modal's location dropdown.</summary>
    [HttpGet("locations")]
    [Authorize(Policy = "RouteBuilder.Read")]
    public async Task<IActionResult> GetLocations()
    {
        var rows = await svc.GetLocationsAsync();
        return Ok(new { response = rows });
    }

    /// <summary>GET /api/driver-scheduling/vehicle-types - vehicle
    /// types the operator can attach to a time slot. Fuels the Add
    /// Time Slot modal's vehicle-types picker (multi-select).</summary>
    [HttpGet("vehicle-types")]
    [Authorize(Policy = "RouteBuilder.Read")]
    public async Task<IActionResult> GetVehicleTypes()
    {
        var rows = await svc.GetVehicleTypesAsync();
        return Ok(new { response = rows });
    }

    // ─── Writes: schedules ─────────────────────────────────────────

    /// <summary>POST /api/driver-scheduling - batch-create
    /// schedules.</summary>
    [HttpPost]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Create([FromBody] SchedulesCreateRequest request)
    {
        try
        {
            var rows = await svc.CreateAsync(request);
            return Ok(new { response = rows });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>DELETE /api/driver-scheduling/{id} - delete a
    /// schedule. Blocked when NotificationSent is set.</summary>
    [HttpDelete("{id:long}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Delete(long id)
    {
        try
        {
            await svc.DeleteAsync(id);
            return Ok(new { response = "Deleted" });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>POST /api/driver-scheduling/send-notifications - batch
    /// SMS all couriers in the target regions for the given schedule
    /// ids. Marks each schedule's NotificationSent.</summary>
    [HttpPost("send-notifications")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> SendNotifications([FromBody] NotificationsRequest request)
    {
        await svc.SendNotificationsAsync(request);
        return Ok(new { response = "Sent" });
    }

    /// <summary>POST /api/driver-scheduling/{id}/send-reminders -
    /// SMS every Available courier on the schedule a "you're
    /// confirmed" reminder.</summary>
    [HttpPost("{id:long}/send-reminders")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> SendReminders(long id)
    {
        try
        {
            await svc.SendScheduleRemindersAsync(id);
            return Ok(new { response = "Sent" });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>POST /api/driver-scheduling/copy - copy every
    /// schedule + timeslot from SourceDate to DestinationDate for the
    /// given location names.</summary>
    [HttpPost("copy")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> Copy([FromBody] ScheduleCopyRequest request)
    {
        try
        {
            await svc.CopyAsync(request);
            return Ok(new { response = "Copied" });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ─── Writes: time slots ────────────────────────────────────────

    /// <summary>POST /api/driver-scheduling/time-slots - create a new
    /// time slot inside an existing schedule window.</summary>
    [HttpPost("time-slots")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> TimeSlotCreate([FromBody] TimeSlotCreateRequest request)
    {
        try
        {
            var row = await svc.TimeSlotCreateAsync(request);
            return Ok(new { response = row });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>POST /api/driver-scheduling/time-slots/{id} - move an
    /// existing time slot. SMS every assigned courier.</summary>
    [HttpPost("time-slots/{id:long}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> TimeSlotUpdate(long id, [FromBody] TimeSlotUpdateRequest request)
    {
        request.Id = id;
        try
        {
            var row = await svc.TimeSlotUpdateAsync(request);
            return Ok(new { response = row });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>DELETE /api/driver-scheduling/time-slots/{id} - delete
    /// a time slot. Assigned couriers fall back to reserve.</summary>
    [HttpDelete("time-slots/{id:long}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> TimeSlotDelete(long id)
    {
        try
        {
            await svc.TimeSlotDeleteAsync(id);
            return Ok(new { response = "Deleted" });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ─── Writes: responses ─────────────────────────────────────────

    /// <summary>POST /api/driver-scheduling/responses/statuses - bulk
    /// update response status (Available=1, Unavailable=3).</summary>
    [HttpPost("responses/statuses")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> ScheduleResponseStatusUpdate([FromBody] ScheduleResponseStatusUpdateRequest request)
    {
        try
        {
            await svc.ScheduleResponseStatusUpdateAsync(request);
            return Ok(new { response = "Updated" });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>POST /api/driver-scheduling/responses/{id}/time-slot -
    /// assign a courier's response to a time slot (pass null TimeSlotId
    /// to move them to reserve).</summary>
    [HttpPost("responses/{id:long}/time-slot")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> ScheduleResponseTimeSlotAssign(long id, [FromBody] ScheduleResponseTimeSlotAssignRequest request)
    {
        request.Id = id;
        try
        {
            await svc.ScheduleResponseTimeSlotAssignAsync(request);
            return Ok(new { response = "Assigned" });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }
}
