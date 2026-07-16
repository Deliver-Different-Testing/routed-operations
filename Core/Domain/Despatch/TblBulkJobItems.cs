#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Per-line item breakdown of a bulk job (used to compute total cubic m^3 for
/// the Vehicle Capacity build constraint). Cubic is stored per-line where
/// provided; otherwise we fall back to Length x Height x Depth / 1e6.
/// </summary>
[Table("tblBulkJobItems")]
public partial class TblBulkJobItems
{
    public int Id { get; set; }
    [Column("JobID")]
    public int? JobId { get; set; }
    public decimal? Cubic { get; set; }
    // Length / Height / Depth are SQL FLOAT (System.Double in .NET); Cubic
    // is decimal. Mixing them requires an explicit Convert.ToDecimal in the
    // JobService projection.
    public double? Length { get; set; }
    public double? Height { get; set; }
    public double? Depth { get; set; }
    public int? Items { get; set; }
}
