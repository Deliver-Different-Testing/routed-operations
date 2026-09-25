// The Despatch DB's speed/service-level lookup table. RunBuilder reads only two
// columns from it - ucjtID (speed number) and ucjtName - for the speed picker.
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tucJobType")]
public partial class TucJobType
{
    [Column("ucjtID")]
    public int UcjtId { get; set; }

    [Column("ucjtName")]
    public string UcjtName { get; set; }

    /// <summary>Per-speed AlertTemplate override. Nullable - falls back
    /// to tblSetting.DefaultJobLabelId / DefaultBulkLabelId when null.
    /// Added 2026-09-18 so RouteViewerLabelService can honour per-speed
    /// label templates in the AlertLabel-direct swap (legacy parity;
    /// column exists in DB, was just not modelled here).</summary>
    public int? LabelId { get; set; }
}
