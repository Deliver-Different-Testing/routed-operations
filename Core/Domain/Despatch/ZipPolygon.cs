// Ported from the Configurator scaffold. ZipPolygon holds one row per postal
// code with its centroid + boundary WKT (Well-Known Text polygon string).
// Populated globally, shared by every tenant. Route zip coverage is a
// many-to-many via the RouteZipcodes junction.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("ZipPolygon")]
public partial class ZipPolygon
{
    [Key]
    [Column("ZipPolygonID")]
    public int ZipPolygonId { get; set; }

    [MaxLength(20)]
    public string Zip { get; set; }

    [Column(TypeName = "decimal(18, 8)")]
    public decimal? Latitude { get; set; }

    [Column(TypeName = "decimal(18, 8)")]
    public decimal? Longitude { get; set; }

    public long? LandAreaSqM { get; set; }

    public long? WaterAreaSqM { get; set; }

    /// <summary>Well-Known Text polygon string ("POLYGON((lng lat, lng lat, ...))"). Consumed client-side by mapping libraries.</summary>
    [Column("WKT")]
    public string Wkt { get; set; }

    public virtual ICollection<Route> Routes { get; set; } = new List<Route>();
}
