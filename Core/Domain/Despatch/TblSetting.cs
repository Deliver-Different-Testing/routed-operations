// System settings singleton. RunViewer legacy scaffold surfaced 100+
// columns; Route Viewer READS only the two AlertTemplate FKs that drive
// LabelService's default-template fallback when a tucJobType.LabelId is
// null. Everything else stays out of the entity so the migration surface
// is minimal and regens do not clobber unused fields.
//
// LabelService pattern:
//   templateId = tucJob.Speed -> tucJobType.LabelId
//                ?? tblSetting.DefaultJobLabelId (or DefaultBulkLabelId)
//                ?? first AlertTemplate of that TemplateType
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tblSetting")]
public partial class TblSetting
{
    [Key]
    public int SettingId { get; set; }

    public int? DefaultJobLabelId { get; set; }

    public int? DefaultBulkLabelId { get; set; }

    [ForeignKey(nameof(DefaultJobLabelId))]
    public virtual AlertTemplate DefaultJobLabel { get; set; }

    [ForeignKey(nameof(DefaultBulkLabelId))]
    public virtual AlertTemplate DefaultBulkLabel { get; set; }
}
