// Label template lookup table. Consumed by LabelService (Route Viewer P14)
// via TucJobType.LabelId and TblSetting.DefaultJobLabelId /
// DefaultBulkLabelId to resolve which AlertLabel template to render for a
// given job or bulk row. Route Viewer READS only; the AlertLabel package
// owns the render pipeline and reads the same table separately.
//
// Trimmed port of the RunViewer legacy AlertTemplate scaffold - dropped the
// LogoData byte[] + HeaderStyle/InformationNStyle style columns (Route
// Viewer does not render labels itself; the AlertLabel package handles
// those) and the reciprocal collection nav properties (TblSetting nav is
// on the owning side; TucJobType FK stays on the owning entity).
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("AlertTemplate")]
public partial class AlertTemplate
{
    [Key]
    public int Id { get; set; }

    [MaxLength(200)]
    public string Name { get; set; }

    /// <summary>Template category (job label, bulk label, etc.). Consumed by
    /// LabelService.GetDefaultTemplateId(templateType) fallback path.</summary>
    public int TemplateType { get; set; }

    public int PageSizeId { get; set; }

    [ForeignKey(nameof(PageSizeId))]
    public virtual AlertTemplatePageSize PageSize { get; set; }
}
