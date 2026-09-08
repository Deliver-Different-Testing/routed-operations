// EF entity for dbo.VehicleType. Simple lookup - Id + Created + Name.
// Distinct from dbo.VehicleSize (which is what RoutedOps already had for
// the RouteBuilder cockpit). VehicleType is the taxonomy CourierManager's
// scheduler uses to constrain which couriers can take which time slot.
//
// Data shape verified via mssql + mssql-dfrnt MCP against Despatch DB
// on 2026-09-07: `VehicleType(Id int not null, Created datetime2 not
// null, Name nvarchar(50) not null)`.
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("VehicleType")]
public class VehicleType
{
    public int Id { get; set; }

    public DateTime Created { get; set; }

    public string Name { get; set; }
}
