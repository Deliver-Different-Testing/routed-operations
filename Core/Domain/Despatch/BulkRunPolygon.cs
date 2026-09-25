// Operator-drawn coverage polygon (Stage 3 RoutedOperations Polygon Builder).
// Storage aligned with shop naming per Steve's spec
// KEVIN-ZIP-POLYGON-TO-CUSTOM-COVERAGE-FLOW-2026-07-29. Points live in
// tblBulkRunPolygonPoint (child, one row per vertex). GeographyData is
// kept in sync by the service layer via raw SQL
// (geography::STGeomFromText(...).MakeValid() + orientation-fixup) so EF
// never has to understand the geography type; frontend reads points
// ordered by OrderIndex and renders them on Google Maps directly.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tblBulkRunPolygon")]
public partial class BulkRunPolygon
{
    [Key]
    public int PolygonId { get; set; }

    [Required]
    [MaxLength(200)]
    public string Name { get; set; }

    [MaxLength(9)]
    public string ColorHex { get; set; }

    [MaxLength(200)]
    public string TagLocation { get; set; }

    [Column(TypeName = "datetime2")]
    public DateTime CreatedUtc { get; set; }

    [Column(TypeName = "datetime2")]
    public DateTime? LastModifiedUtc { get; set; }

    /// <summary>0 = Manual draw, 1 = seeded from a ZipPolygon shape.</summary>
    public byte SourceType { get; set; }

    /// <summary>ZIP / postcode when SourceType = 1; NULL when Manual.</summary>
    [MaxLength(20)]
    public string SourceCode { get; set; }

    [Column(TypeName = "decimal(9, 6)")]
    public decimal CentroidLatitude { get; set; }

    [Column(TypeName = "decimal(9, 6)")]
    public decimal CentroidLongitude { get; set; }

    public bool Active { get; set; } = true;

    [Required]
    [MaxLength(100)]
    public string CreatedBy { get; set; }

    [MaxLength(100)]
    public string UpdatedBy { get; set; }

    /// <summary>Comma-delimited zip list (with leading + trailing commas)
    /// derived at save time via spatial overlay against dbo.ZipPolygon.
    /// Consumed by UTL_stpRouteAutoAssign_ResolveOneSide as a pre-filter
    /// before running the STIntersects spatial containment test. NULL when
    /// derivation returned zero overlapping zips.</summary>
    public string PartiallyIncludedZips { get; set; }

    public virtual ICollection<BulkRunPolygonPoint> Points { get; set; } = new List<BulkRunPolygonPoint>();

    public virtual ICollection<Route> Routes { get; set; } = new List<Route>();
}
