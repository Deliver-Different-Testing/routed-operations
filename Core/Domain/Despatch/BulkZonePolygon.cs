#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// A custom polygon's membership of a zone number inside a zone group
/// (custom-polygons spec 3.1). The polygon twin of BulkZonePostcode: that
/// table says "this postcode is Zone N in this group", this one says "this
/// shape is Zone N in this group".
///
/// Zone groups are what decide whether a client can book to an address, and
/// until now only postcodes could be members. A polygon could be attached to
/// a schedule (tblSchedulePolygon) but no stored procedure ever read that
/// table, so schedule-attached polygons had no effect on booking at all.
///
/// A shape may be Zone 4 in one group and Zone 2 in another, because a group
/// belongs to a depot. Two zones for one shape inside ONE group is a
/// contradiction the resolver cannot settle, which is what
/// UQ_BulkZonePolygon (PostcodeGroupId, PolygonId) prevents.
/// </summary>
[Table("BulkZonePolygon")]
public partial class BulkZonePolygon
{
    public int Id { get; set; }

    /// <summary>FK to BulkZonePostcodeGroup.Id.</summary>
    public int PostcodeGroupId { get; set; }

    public int Zone { get; set; }

    /// <summary>FK to tblBulkRunPolygon.PolygonId.</summary>
    public int PolygonId { get; set; }

    public bool Active { get; set; } = true;

    public DateTime CreatedUtc { get; set; }

    [MaxLength(100)]
    public string CreatedBy { get; set; }
}

/// <summary>
/// Normalised form of tblBulkRunPolygon.PartiallyIncludedZips
/// (custom-polygons spec 3.5): one row per (polygon, postcode it overlaps).
///
/// It exists purely for seek performance. Resolution rule 2 asks "which
/// shapes mention this postcode" on the booking path, and against the packed
/// column that is LIKE '%,pc,%' over every polygon in the tenant. Clustered
/// on (Zip, PolygonId) so the question is answered by one seek.
///
/// Maintained in BulkPolygonService at the same point the packed column is
/// derived. The packed column stays until the route resolver is pointed here
/// too, so the two changes stay independently reviewable.
/// </summary>
[Table("BulkRunPolygonZip")]
public partial class BulkRunPolygonZip
{
    public int PolygonId { get; set; }

    [MaxLength(10)]
    public string Zip { get; set; }
}
