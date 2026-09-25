// EF entity for dbo.CourierScheduleTimeSlot. Sub-window inside a
// CourierSchedule's Start/End range. Couriers assigned to a slot get
// SMS'd when the slot's BookDateTime changes.
//
// Column shape verified via mssql MCP 2026-09-07: 6 columns. Wanted
// nullable = "no cap".
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("CourierScheduleTimeSlot")]
public class CourierScheduleTimeSlot
{
    public long Id { get; set; }

    public DateTime Created { get; set; }

    public int? SiteId { get; set; }

    public DateTime BookDateTime { get; set; }

    public int? Wanted { get; set; }

    public int? LocationId { get; set; }

    [ForeignKey(nameof(LocationId))]
    public virtual TblBulkRegion Location { get; set; }

    public virtual ICollection<CourierScheduleResponse> CourierScheduleResponses { get; set; }
        = new List<CourierScheduleResponse>();

    public virtual ICollection<CourierScheduleTimeSlotVehicleType> CourierScheduleTimeSlotVehicleTypes { get; set; }
        = new List<CourierScheduleTimeSlotVehicleType>();
}
