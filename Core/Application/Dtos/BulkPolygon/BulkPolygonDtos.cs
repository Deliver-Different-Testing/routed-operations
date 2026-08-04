namespace RoutedOperations.Core.Application.Dtos.BulkPolygon;

/// <summary>One vertex. OrderIndex ascending around the ring; ring auto-closes.</summary>
public record PolygonPointDto(int OrderIndex, double Lat, double Lng);

/// <summary>SourceType: 0 = Manual draw, 1 = seeded from a ZipPolygon.
/// PartiallyIncludedZips carries the leading/trailing-comma zip string
/// derived on save via spatial overlay against ZipPolygon; frontend
/// strips the sentinel commas before splitting.</summary>
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
