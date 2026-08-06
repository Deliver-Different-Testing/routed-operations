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
    byte SourceType,
    string? SourceCode,
    decimal CentroidLatitude,
    decimal CentroidLongitude,
    bool Active,
    List<PolygonPointDto> Points,
    int AttachedRouteCount,
    List<BulkPolygonAttachedRouteDto> AttachedRoutes,
    string? PartiallyIncludedZips,
    DateTime CreatedUtc,
    string CreatedBy,
    DateTime? LastModifiedUtc,
    string? UpdatedBy);

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
