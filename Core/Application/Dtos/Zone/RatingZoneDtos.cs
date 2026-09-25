namespace RoutedOperations.Core.Application.Dtos.Zone;

/// <summary>
/// Read-only rating-geography DTOs surfaced by the Polygon Builder
/// "VIEW Zones" drawer. Response shape matches George's spec
/// (POLYGON-BUILDER-VIEW-ZONES-NZ-US-HANDOVER-2026-07-30) so one shape
/// works for both NZ and US tenants; the frontend uses `CountryCode` +
/// `ZoneName` presence to decide how to label the row.
/// </summary>
public record RatingZoneDepotDto(
    string CountryCode,
    int DepotId,
    string DepotName,
    int PostcodeCount,
    List<RatingZoneGroupDto> Groups);

public record RatingZoneGroupDto(
    int? GroupId,
    string GroupName,
    string? ZoneName,
    int PostcodeCount,
    List<RatingZoneBucketDto> Zones);

public record RatingZoneBucketDto(
    int Zone,
    List<string> Postcodes);
