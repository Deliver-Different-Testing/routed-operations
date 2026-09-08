// EF entity for dbo.CourierScheduleResponseStatus - the (Id, Name)
// lookup driving the tri-state courier response tab (Pending=null,
// Available=1, Unavailable=3, NoResponse=2 dead).
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("CourierScheduleResponseStatus")]
public class CourierScheduleResponseStatus
{
    public int Id { get; set; }

    public string Name { get; set; }
}
