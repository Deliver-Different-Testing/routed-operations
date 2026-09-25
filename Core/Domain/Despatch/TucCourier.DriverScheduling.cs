// Driver Scheduling partial extending TucCourier with the fields the
// scheduler service reads (region + mobile numbers + vehicle taxonomy
// + internal-staff flag). Kept in its own partial file so the base
// TucCourier.cs + RouteViewer partial stay slim per feature.
//
// UccrInternal / UccrMobile / PersonalMobile / UccrVehicle / RegionId
// are all columns on dbo.tucCourier - verified via mssql MCP. The
// legacy scheduler filters `Active && !UccrInternal` and uses the
// mobile fields for SMS dispatch.
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucCourier
{
    [Column("UccrInternal")]
    public bool UccrInternal { get; set; }

    [Column("RegionID")]
    public int? RegionId { get; set; }

    [Column("UccrMobile")]
    public string UccrMobile { get; set; }

    [Column("PersonalMobile")]
    public string PersonalMobile { get; set; }

    [Column("UccrVehicle")]
    public string UccrVehicle { get; set; }
}
