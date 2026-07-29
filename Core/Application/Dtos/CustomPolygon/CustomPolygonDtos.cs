namespace RoutedOperations.Core.Application.Dtos.CustomPolygon;

/// <summary>Read shape for an operator-drawn custom polygon.</summary>
public record CustomPolygonDto(
    int CustomZipPolygonId,
    string Name,
    decimal CentroidLatitude,
    decimal CentroidLongitude,
    string Wkt,
    bool Active,
    int AttachedRouteCount,
    DateTime CreatedAt,
    DateTime? UpdatedAt);

/// <summary>Create payload. Centroid is precomputed by the frontend from the drawn vertices; server stores as-is.</summary>
public record CreateCustomPolygonRequest(
    string Name,
    decimal CentroidLatitude,
    decimal CentroidLongitude,
    string Wkt);

/// <summary>Rename-only update (name / metadata). Shape edits go through /shape.</summary>
public record UpdateCustomPolygonMetaRequest(string Name);

/// <summary>Reshape update. Centroid is recomputed by the frontend from the new vertices.</summary>
public record UpdateCustomPolygonShapeRequest(
    decimal CentroidLatitude,
    decimal CentroidLongitude,
    string Wkt);
