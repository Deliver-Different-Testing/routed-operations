namespace RoutedOperations.Core.Application.Dtos.BulkPolygon;

/// <summary>One vertex. RingIndex identifies which ring the point belongs
/// to (0 = first ring; multi-ring polygons use 1, 2, ... for holes and /
/// or disjoint pieces - winding order encodes hole vs outer). OrderIndex
/// ascends around the current ring; ring auto-closes at write time.</summary>
public record PolygonPointDto(int RingIndex, int OrderIndex, double Lat, double Lng);

/// <summary>Lightweight route link for the Polygon Builder sidebar. Lets
/// the operator see which route(s) a coverage polygon is attached to and
/// jump directly into the route editor. Only active routes are listed.</summary>
public record BulkPolygonAttachedRouteDto(int RouteId, string RouteName);

/// <summary>SourceType: 0 = Manual draw, 1 = seeded from a ZipPolygon.
/// PartiallyIncludedZips carries the leading/trailing-comma zip string
/// derived on save via spatial overlay against ZipPolygon; frontend
/// strips the sentinel commas before splitting.
/// AttachedRoutes carries the full list of active routes using this
/// polygon; AttachedRouteCount is kept for backward-compat with any
/// caller still reading the count directly (matches the list length).</summary>
public record BulkPolygonDto(
    int PolygonId,
    string Name,
    /// <summary>The shape's own colour. Carried so a coverage chip can be
    /// drawn in it and read as a polygon rather than a postcode (polygons
    /// spec part 1).</summary>
    string? ColorHex,
    byte SourceType,
    string? SourceCode,
    decimal CentroidLatitude,
    decimal CentroidLongitude,
    bool Active,
    List<PolygonPointDto> Points,
    int AttachedRouteCount,
    List<BulkPolygonAttachedRouteDto> AttachedRoutes,
    /// <summary>Zone memberships (custom-polygons spec 3.1). Which zone
    /// number this shape is in, in which zone group. Empty until ops places
    /// it with "Add to zone".</summary>
    List<BulkPolygonZoneMembershipDto> ZoneMemberships,
    string? PartiallyIncludedZips,
    DateTime CreatedUtc,
    string CreatedBy,
    DateTime? LastModifiedUtc,
    string? UpdatedBy,
    /// <summary>ZoneName this polygon is bound to (Phase-5 tblBulkRunPolygon.ZoneNameId). Null when unbound.</summary>
    int? ZoneNameId = null,
    /// <summary>PostcodeGroup this polygon is bound to (Phase-5 tblBulkRunPolygon.PostcodeGroupId). Null when unbound.</summary>
    int? PostcodeGroupId = null,
    /// <summary>Schedule groups bound via tblSchedulePolygon. Empty when unbound.</summary>
    List<string>? AttachedScheduleNames = null,
    /// <summary>Resolved ZoneName.ZoneName1 for the ZoneNameId binding. Null when unbound or the row was deleted.</summary>
    string? ZoneNameName = null,
    /// <summary>Resolved BulkZonePostcodeGroup.Name for the PostcodeGroupId binding. Null when unbound or the row was deleted.</summary>
    string? PostcodeGroupName = null);

/// <summary>Create payload. Client precomputes centroid; server stores as-is.</summary>
public record CreateBulkPolygonRequest(
    string Name,
    decimal CentroidLatitude,
    decimal CentroidLongitude,
    List<PolygonPointDto> Points,
    byte SourceType = 0,
    string? SourceCode = null);

/// <summary>Rename-only update. Shape edits go through /shape.</summary>
public record UpdateBulkPolygonMetaRequest(string Name);

/// <summary>Reshape update. Client recomputes centroid from the new vertices.</summary>
public record UpdateBulkPolygonShapeRequest(
    decimal CentroidLatitude,
    decimal CentroidLongitude,
    List<PolygonPointDto> Points);

/// <summary>One row of a polygon's zone membership list.</summary>
public record BulkPolygonZoneMembershipDto(
    int Id,
    int PostcodeGroupId,
    string PostcodeGroupName,
    int DepotId,
    string DepotName,
    int Zone);

/// <summary>Body for POST /api/bulk-polygons/{polygonId}/zones.</summary>
public class BulkPolygonAddToZoneRequest
{
    public int PostcodeGroupId { get; set; }
    public int Zone { get; set; }
}
