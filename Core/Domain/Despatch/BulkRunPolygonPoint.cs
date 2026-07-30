// One vertex on a BulkRunPolygon. OrderIndex is 0-based, ascending
// around the ring. Ring auto-closes at read/write time - callers should
// NOT include a duplicate closing vertex.
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

    public int OrderIndex { get; set; }

    public double Lat { get; set; }

    public double Lng { get; set; }
}
