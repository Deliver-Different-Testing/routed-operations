namespace RoutedOperations.Core.Application.Dtos.Territory;

/// <summary>
/// Territory (zones + zone groups + postcode groups) DTOs surfaced by
/// /api/territory. Tenant-aware: NZ path returns postcode rows, US path
/// returns zip-zone rows. Kept as separate DTO shapes on purpose - do
/// NOT collapse into one shared shape (handover doc rule 4).
/// </summary>
public record DepotDto(int Id, string Name, bool Active);

/// <summary>A depot as the per-client limit editor sees it: every depot in the
/// tenant, with whether it is switched off for the client being edited.
/// <paramref name="Active"/> is the global on/off; <paramref name="OffForClient"/>
/// is the separate per-client one, and a depot that is globally inactive is
/// unavailable to every client regardless.</summary>
public record DepotClientLimitDto(int Id, string Name, bool Active, bool OffForClient);

/// <summary>One postcode outline for the zone-group map, with the zone it is
/// in so the map can shade by zone. Wkt is the stored boundary; Latitude and
/// Longitude are the centroid, used to label and to fit the map when a code
/// has no outline.</summary>
public record ZoneMapShapeDto(
    int Zone,
    string Code,
    int ZipPolygonId,
    decimal? Latitude,
    decimal? Longitude,
    string Wkt);

/// <summary>
/// Everything the map panel beside a zone group needs. Codes that have no
/// ZipPolygon row are reported rather than dropped: the map showing eight of
/// a group's ten zones with no explanation is worse than saying which are
/// missing.
/// </summary>
public record ZoneMapDto(
    int PostcodeGroupId,
    string PostcodeGroupName,
    int? DepotId,
    string DepotName,
    decimal? DepotLatitude,
    decimal? DepotLongitude,
    List<ZoneMapShapeDto> Shapes,
    /// <summary>Member codes with no boundary on file, padded for display.</summary>
    List<string> CodesWithNoShape);

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
/// <summary>
/// What a ZIP paste into a US zone did, split so the operator can see the
/// difference between work done and work skipped. A paste of Ruth's Cheetah
/// file is 602 ZIPs across eight zones, so "it worked" is not a useful
/// answer on its own.
/// </summary>
/// <param name="Added">ZIPs now in this zone that were not before.</param>
/// <param name="AlreadyInThisZone">
/// Already present, so not written again. Not an error: re-pasting a
/// corrected list is the normal way to fix one.
/// </param>
/// <param name="Ignored">
/// Entries that could not be read as a US ZIP, returned verbatim so the
/// operator can see what was in their paste rather than guessing.
/// </param>
public record ZoneZipPasteResultDto(
    List<string> Added,
    List<string> AlreadyInThisZone,
    List<string> Ignored);

/// <summary>One code inside a zone, for the chips in the group drawer.
///
/// <paramref name="Code"/> is the display spelling, padded: NZ stores
/// BulkZonePostcode.PostCode as an int so 0110 Whangarei lives as 110, and
/// 673 of Urgent's 3,025 rows are that shape. The raw int is in
/// <paramref name="Value"/> for callers that need to match on it.
/// </summary>
public record PostcodeGroupMemberDto(
    int Id,
    string Code,
    int Value,
    /// <summary>Suburb or zone label. NZ reads BulkZonePostcode.Name, which
    /// already carries it on 2,909 of 3,025 rows; US reads the ZoneName.
    /// Blank where the tenant never set one.</summary>
    string Suburb);

public record PostcodeGroupZoneDto(
    int Zone,
    string Label,
    int MemberCount,
    /// <summary>The codes themselves, so the drawer can list a zone's
    /// postcodes before its polygons (spec 3.2) rather than only count them.</summary>
    List<PostcodeGroupMemberDto> Members);

/// <param name="Added">Codes written, in the padded display spelling.</param>
/// <param name="SkippedInOtherZone">
/// Codes already in a DIFFERENT zone of this same group, with that zone's
/// number, and deliberately not moved. On Urgent production no postcode sits
/// in two zones of one group, so silently moving one would break an invariant
/// the rating function relies on.
/// </param>
/// <param name="AlreadyInThisZone">Codes that were already here. A no-op, reported so a
/// re-paste reads as "nothing to do" rather than as a failure.</param>
/// <param name="Ignored">Entries that could not be read as an NZ postcode,
/// returned verbatim so the operator can see what was in their paste.</param>
public record NzPostcodePasteResultDto(
    List<string> Added,
    List<PostcodeInOtherZoneDto> SkippedInOtherZone,
    List<string> AlreadyInThisZone,
    List<string> Ignored);

public record PostcodeInOtherZoneDto(string Code, int Zone, string ZoneLabel);

/// <param name="Group">The copy, in the same shape the list returns.</param>
/// <param name="MembersCopied">Postcode rows (NZ) or zip rows (US) written.</param>
/// <param name="ZonesCopied">Distinct zone numbers carried over.</param>
/// <param name="PolygonsCopied">
/// Polygon memberships the copy got, written the same way the postcodes are:
/// a new BulkZonePolygon row per shape, same PolygonId, same zone. The shape
/// itself is neither cloned nor moved, because BulkZonePolygon is unique on
/// (PostcodeGroupId, PolygonId) rather than on PolygonId alone, so one shape
/// can be zone 4 here and zone 2 in the copy's group and the original keeps
/// it. Spec 3.1, migration 20261007170000.
/// </param>
public record PostcodeGroupDuplicateResultDto(
    PostcodeGroupDto Group,
    int MembersCopied,
    int ZonesCopied,
    int PolygonsCopied);

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

/// <summary>A driver location list (tblClearListArea) as the zone group
/// form's Clear-List Area picker shows it.</summary>
public record ClearListAreaDto(
    int Id,
    string Code,
    string Name);

/// <summary>Polygon binding view - the subset of tblBulkRunPolygon
/// columns the Zone Groups tab needs to list "polygons bound to this
/// zone" and to render binding state chips.</summary>
/// <summary>A polygon bound to a US ZoneName, or a member of a zone inside a
/// postcode group. The two axes are stored differently and that shows here:
/// ZoneName binding is the single column tblBulkRunPolygon.ZoneNameId, while
/// group membership is a BulkZonePolygon row, so it carries the zone number it
/// joined and its own id. Zone and MembershipId are therefore null on the
/// ZoneName side.</summary>
public record BoundPolygonDto(
    int PolygonId,
    string Name,
    int? ZoneNameId,
    int? PostcodeGroupId,
    decimal CentroidLatitude,
    decimal CentroidLongitude,
    int? Zone = null,
    int? MembershipId = null);

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
