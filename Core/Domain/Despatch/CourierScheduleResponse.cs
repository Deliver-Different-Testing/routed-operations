// EF entity for dbo.CourierScheduleResponse. One row per (Schedule,
// Courier) with the courier's opt-in state:
//   StatusId 1 = Available (courier said yes)
//   StatusId 3 = Unavailable (courier said no, or admin cancelled)
//   null      = Pending (still waiting for reply)
// TimeSlotId nullable - null = "on reserve" (courier available but no
// specific slot assigned yet).
//
// Column shape verified via mssql MCP 2026-09-07: 9 columns.
//
// Two DB triggers on this table enforce overbooking prevention on
// INSERT + TimeSlotId-UPDATE:
//   `RAISERROR('Time Slot has already been filled.', 16, 1)`
// when `TimeSlot.Wanted <= count(Available responses for slot)`.
// DriverSchedulingService wraps SaveChanges to translate that
// message into a clean 409 for the operator.
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("CourierScheduleResponse")]
public class CourierScheduleResponse
{
    public long Id { get; set; }

    public long ScheduleId { get; set; }

    public int CourierId { get; set; }

    public int StatusId { get; set; }

    public DateTime? NotificationSent { get; set; }

    public int? NotificationStatusId { get; set; }

    public DateTime Created { get; set; }

    public DateTime Updated { get; set; }

    public long? TimeSlotId { get; set; }

    [ForeignKey(nameof(ScheduleId))]
    public virtual CourierSchedule Schedule { get; set; }

    [ForeignKey(nameof(CourierId))]
    public virtual TucCourier Courier { get; set; }

    [ForeignKey(nameof(StatusId))]
    public virtual CourierScheduleResponseStatus Status { get; set; }

    [ForeignKey(nameof(TimeSlotId))]
    public virtual CourierScheduleTimeSlot TimeSlot { get; set; }
}
