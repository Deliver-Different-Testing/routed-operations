// Fleet lookup - courier belongs to at most one fleet via CourierFleetID.
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tucCourierFleet")]
public partial class TucCourierFleet
{
    [Column("UccfID")]
    public int UccfId { get; set; }

    [Column("UccfName")]
    public string UccfName { get; set; }
}
