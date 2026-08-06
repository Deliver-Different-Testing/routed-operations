// One vertex on a BulkRunPolygon.
//   RingIndex  = 0-based ring number. Ring 0 is the polygon's first (and,
//                for legacy pre-2026-08-06 rows, only) ring. Subsequent
//                rings encode multi-piece polygons and holes; winding
//                order distinguishes outer (CCW) from hole (CW) - Google
//                Maps Polygon.setPaths() consumes this directly.
//   OrderIndex = 0-based, ascending around the current ring. Rings
//                auto-close at read/write time - callers should NOT
//                include a duplicate closing vertex.
// Read path orders by (PolygonId, RingIndex, OrderIndex).
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tblBulkRunPolygonPoint")]
public partial class BulkRunPolygonPoint
{
    [Key]
    public int PolygonPointId { get; set; }

    public int PolygonId { get; set; }

    public int RingIndex { get; set; }

    public int OrderIndex { get; set; }

    public double Lat { get; set; }

    public double Lng { get; set; }
}
