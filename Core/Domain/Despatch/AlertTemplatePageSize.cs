// Companion to AlertTemplate.PageSizeId. Route Viewer reads for template
// dropdowns and to expose the page-size name in operator-facing label
// lists. AlertLabel package uses ReportName to select the SSRS report.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("AlertTemplatePageSize")]
public partial class AlertTemplatePageSize
{
    [Key]
    public int Id { get; set; }

    [MaxLength(100)]
    public string Name { get; set; }

    [MaxLength(200)]
    public string ReportName { get; set; }
}
