// Ported from the Configurator EF Power Tools scaffold. The Despatch DB's
// courier table is `tucCourier`, not `tblCourier`. Legacy code aliased it via
// stored procedure output; here we join it directly.
//
// Only the columns RunBuilder uses are declared. There is no `Active` bit on
// tucCourier - "active" is expressed as `UccrFinishDate IS NULL`.
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
}
