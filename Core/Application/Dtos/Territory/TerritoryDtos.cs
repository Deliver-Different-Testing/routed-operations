namespace RoutedOperations.Core.Application.Dtos.Territory;

/// <summary>
/// Territory (zones + zone groups + postcode groups) DTOs surfaced by
/// /api/territory. Tenant-aware: NZ path returns postcode rows, US path
/// returns zip-zone rows. Kept as separate DTO shapes on purpose - do
/// NOT collapse into one shared shape (handover doc rule 4).
/// </summary>
public record DepotDto(int Id, string Name, bool Active);

public record PostcodeGroupDto(
    int Id,
    string Name,
    int? DepotId,
    string DepotName,
    int? ClientId,
    /// <summary>Client code resolved from ClientId (e.g. "ACME"). Null when the group is client-agnostic.</summary>
    string ClientCode,
    int PostcodeCount);

/// <summary>NZ (non-US) rating-postcode row. One per BulkZonePostcode.</summary>
public record NzPostcodeDto(
    int Id,
    int PostCode,
    int Zone,
    int? DepotId,
    string DepotName,
    int? PostcodeGroupId,
    string PostcodeGroupName,
    int FromSiteId,
    string Name,
    string FromLatLng);

/// <summary>US rating-zip row. One per ZoneZip.</summary>
public record UsZipZoneDto(
    int Id,
    string Zip,
    int? ZoneNumber,
    int? ZoneNameId,
    string ZoneName,
    int? ZoneGroupId,
    string ZoneGroupName,
    int? PostcodeGroupId,
    string PostcodeGroupName,
    bool? ApplyCongestion);

public record ZoneNameDto(
    int Id,
    string Name,
    int? ZoneGroupId,
    string ZoneGroupName,
    int? LocationId,
    string LocationName,
    int ZipCount);

public record ZoneGroupDto(
    int Id,
    string Name,
    int? ClearListAreaId,
    int ZoneNameCount);

/// <summary>Polygon binding view - the subset of tblBulkRunPolygon
/// columns the Zone Groups tab needs to list "polygons bound to this
/// zone" and to render binding state chips.</summary>
public record BoundPolygonDto(
    int PolygonId,
    string Name,
    int? ZoneNameId,
    int? PostcodeGroupId,
    decimal CentroidLatitude,
    decimal CentroidLongitude);

/// <summary>Envelope returned by /api/territory/bootstrap so the React
/// side can populate all three tabs from one roundtrip.</summary>
public record TerritoryBootstrapDto(
    string CountryCode,
    List<DepotDto> Depots,
    List<PostcodeGroupDto> PostcodeGroups,
    List<NzPostcodeDto> NzPostcodes,
    List<UsZipZoneDto> UsZipZones,
    List<ZoneNameDto> ZoneNames,
    List<ZoneGroupDto> ZoneGroups);
