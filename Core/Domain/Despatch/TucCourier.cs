// Ported from the Configurator EF Power Tools scaffold. The Despatch DB's
// courier table is `tucCourier`, not `tblCourier`. Legacy code aliased it via
// stored procedure output; here we join it directly.
//
// Both `tucCourier` and the older `tblCourier` mirror the same row set on
// tenants observed to date, and both carry an `Active` BIT. The legacy
// UTL_stpCourier_Active SP filters on `Active = 1` from tblCourier - we
// use the same bit on tucCourier for parity.
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tucCourier")]
public partial class TucCourier
{
    [Column("UccrID")]
    public int UccrId { get; set; }

    public string Code { get; set; }

    [Column("UccrName")]
    public string UccrName { get; set; }

    [Column("UccrSurname")]
    public string UccrSurname { get; set; }

    [Column("CourierFleetID")]
    public int? CourierFleetId { get; set; }

    [Column("UccrStartDate")]
    public DateTime? UccrStartDate { get; set; }

    [Column("UccrFinishDate")]
    public DateTime? UccrFinishDate { get; set; }

    // Matches the `Active` BIT the legacy UTL_stpCourier_Active SP filters on.
    // Non-nullable per DB schema. True = courier appears in the operator's
    // active picker.
    public bool Active { get; set; }
}
