// Operator-drawn custom polygon (Stage 2 RoutedOperations Polygon Builder).
// Lives alongside the shipped-globally ZipPolygon table but in a separate
// row-set so the 33k-row zip reference data stays untouched. Custom shapes
// participate in prebook auto-assign via the point-in-polygon fallback in
// UTL_stpRouteAutoAssign_ResolveOneSide when the zip-string pass returns
// no candidates AND the booking has resolved pickup coordinates.
//
// GeographyData is a plain (non-computed) column kept in sync by the
// service layer via an inline geography::STGeomFromText call on write.
// Not mapped in EF because EF Core has no first-class geography type
// without NetTopologySuite; the frontend only ever needs the Wkt anyway.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("CustomZipPolygon")]
public partial class CustomZipPolygon
{
    [Key]
    [Column("CustomZipPolygonId")]
    public int CustomZipPolygonId { get; set; }

    [Required]
    [MaxLength(100)]
    public string Name { get; set; }

    [Column(TypeName = "decimal(9, 6)")]
    public decimal CentroidLatitude { get; set; }

    [Column(TypeName = "decimal(9, 6)")]
    public decimal CentroidLongitude { get; set; }

    /// <summary>Well-Known Text polygon string, SRID 4326. Written to GeographyData via a service-layer raw SQL update on save.</summary>
    [Required]
    [Column("Wkt")]
    public string Wkt { get; set; }

    public bool Active { get; set; } = true;

    [Column(TypeName = "datetime")]
    public DateTime CreatedAt { get; set; }

    [Required]
    [MaxLength(100)]
    public string CreatedBy { get; set; }

    [Column(TypeName = "datetime")]
    public DateTime? UpdatedAt { get; set; }

    [MaxLength(100)]
    public string UpdatedBy { get; set; }

    public virtual ICollection<Route> Routes { get; set; } = new List<Route>();
}
