namespace RoutedOperations.Core.Application.Dtos.Territory;

/// <summary>
/// Territory (zones + zone groups + postcode groups) DTOs surfaced by
/// /api/territory. Tenant-aware: NZ path returns postcode rows, US path
/// returns zip-zone rows. Kept as separate DTO shapes on purpose - do
/// NOT collapse into one shared shape (handover doc rule 4).
/// </summary>
public record DepotDto(int Id, string Name, bool Active);

/// <summary>
/// A postcode / zip group. ONE table (BulkZonePostcodeGroup) serves both
/// tenants; only the member table differs - BulkZonePostcode on NZ,
/// ZoneZip on US via FK_ZoneZip_BulkZonePostcodeGroup. Do NOT confuse
/// this with <see cref="ZoneGroupDto"/>, which is the parent of ZoneName
/// for clear lists and gates no booking. See
/// .claude/sp-reference/zones-zone-groups-and-schedules.md.
/// </summary>
public record PostcodeGroupDto(
    int Id,
    string Name,
    int? DepotId,
    string DepotName,
    int? ClientId,
    /// <summary>Client code resolved from ClientId (e.g. "ACME"). Null when the group is client-agnostic.</summary>
    string ClientCode,
    /// <summary>Member count. Counts BulkZonePostcode on NZ and ZoneZip on US,
    /// so a single count is wrong on one tenant or the other.</summary>
    int PostcodeCount,
    /// <summary>Distinct zone numbers used by this group's members.</summary>
    int ZoneCount,
    /// <summary>Active polygons bound to this group.</summary>
    int PolygonCount,
    /// <summary>Schedules (distinct headers, not day rows) using this group for
    /// DELIVERY coverage.</summary>
    int DeliveryScheduleCount,
    /// <summary>Schedules using this group for PICKUP coverage. Counted
    /// separately because plenty of groups are pickup-only and a single
    /// combined figure shows them as unused: on Urgent production
    /// "PU Regional Tauranga Z1" is 0 delivery and 329 pickup day rows.</summary>
    int PickupScheduleCount);

/// <summary>One zone inside a group, with how many members carry it.
/// The label comes from BulkZonePostcode.Name on NZ (denormalised onto
/// every member row) and from ZoneName.ZoneName1 on US.</summary>
public record PostcodeGroupZoneDto(
    int Zone,
    string Label,
    int MemberCount);

/// <summary>A schedule that references this group, and on which side.
/// A schedule can use the same group for both pickup and delivery, so the
/// two flags are not exclusive.</summary>
public record PostcodeGroupScheduleDto(
    int ScheduleId,
    string Name,
    bool UsedForDelivery,
    bool UsedForPickup,
    /// <summary>How many of the schedule's day rows reference the group.</summary>
    int DayCount);

/// <summary>Group detail: the group itself plus everything that points at
/// it. Nothing on the group row gives it force; these references do.</summary>
public record PostcodeGroupDetailDto(
    PostcodeGroupDto Group,
    List<PostcodeGroupZoneDto> Zones,
    List<PostcodeGroupScheduleDto> Schedules,
    List<BoundPolygonDto> Polygons);

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
