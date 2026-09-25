// EF entity for dbo.CourierScheduleTimeSlotVehicleType - junction
// between a time slot and the vehicle types eligible for it. Empty
// junction = "any vehicle". Non-empty = a courier's UccrVehicle must
// match one of the linked VehicleType.Name entries or assignment is
// rejected (per legacy vehicle-fit-on-assign guard).
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("CourierScheduleTimeSlotVehicleType")]
public class CourierScheduleTimeSlotVehicleType
{
    public long Id { get; set; }

    public DateTime Created { get; set; }

    public long TimeSlotId { get; set; }

    public int VehicleTypeId { get; set; }

    [ForeignKey(nameof(TimeSlotId))]
    public virtual CourierScheduleTimeSlot TimeSlot { get; set; }

    [ForeignKey(nameof(VehicleTypeId))]
    public virtual VehicleType VehicleType { get; set; }
}
