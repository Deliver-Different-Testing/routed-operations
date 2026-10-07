namespace RoutedOperations.Core.Application.Dtos.RecurringRoute;

/// <summary>Feature 5.1 Routes.Direction values. A byte rather than an enum
/// because the column is tinyint and CK_Routes_Direction is the authority on
/// what is valid; an enum would invite a third member that the database
/// rejects.</summary>
// NOTE: plural on purpose. "RouteDirection" collides with
// Microsoft.AspNetCore.Routing.RouteDirection, which the implicit usings pull
// in, and the collision is a hard CS0104 at every use site. Do not "fix" the
// name back to the singular.
public static class RouteDirections
{
    /// <summary>Collect from the customer. Every pre-existing route.</summary>
    public const byte FirstMile = 1;

    /// <summary>Fan out from one origin to the drop.</summary>
    public const byte FinalMile = 2;

    public static bool IsValid(byte value) => value is FirstMile or FinalMile;
}

/// <summary>Where a final-mile route fans out from when the origin is an
/// ADDRESS rather than a depot. Grouped instead of six loose fields because
/// they move together: CK_Routes_Direction accepts a final-mile route with a
/// depot OR with a complete coordinate pair, so "has an address origin" is one
/// decision, not six.
///
/// RadiusM is METRES and may be null, in which case the resolver applies its
/// own documented 5000 m default.</summary>
public record RouteOriginDto(
    string? Name,
    string? Address,
    string? Zip,
    decimal? Latitude,
    decimal? Longitude,
    int? RadiusM);

/// <summary>Zip code attached to a route (via the RouteZipcodes junction).</summary>
public record RouteZipcodeDto(int ZipPolygonId, string Zip);

/// <summary>Bulk polygon summary attached to a route (id + name + centroid; full points list via /api/bulk-polygons/{id}).</summary>
public record RouteBulkPolygonDto(int PolygonId, string Name, decimal CentroidLatitude, decimal CentroidLongitude);

/// <summary>Schedule attached to a route (via the tblRouteSchedule junction).
/// Days is the list of ISO days-of-week (1=Mon...7=Sun) the schedule covers.</summary>
public record RouteScheduleDto(int ScheduleId, string Name, string Window, List<int> Days);

/// <summary>
/// Read shape for a Route. Mirrors the Configurator TenantRouteDto contract
/// so operators moving between the two apps see identical fields.
/// TargetType: 1=Courier, 2=Agent, 3=NetworkPartner.
///
/// 2026-08-03: Schedule became M:N. The single ScheduleId/ScheduleName/
/// ScheduleWindow fields are kept for backwards-compat display (they show
/// the FIRST bound schedule so pre-migration UIs stay readable) but the
/// authoritative list lives in Schedules.
/// </summary>
public record RouteDto(
    int RouteId,
    string Name,
    string Area,
    byte? DefaultTargetType,
    int? DefaultTargetId,
    string DefaultTargetName,
    int? ScheduleId,
    string ScheduleName,
    string ScheduleWindow,
    List<RouteScheduleDto> Schedules,
    bool Active,
    List<RouteZipcodeDto> Zipcodes,
    List<RouteBulkPolygonDto> BulkPolygons,
    int RosterEntryCount,
    int BookingCount,
    int MappedStopsCount,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    // Feature 5.1. Appended rather than slotted in beside Area so the
    // positional arity change is confined to the tail and every existing
    // reader keeps reading the same field at the same index.
    byte Direction,
    int? DepotId,
    string DepotName,
    RouteOriginDto? Origin);

/// <summary>One live recurring booking bound to a route. Populated by the
/// read-only "Bookings on this route" list in the Route editor modal.</summary>
public record RouteBookingDto(
    int Id,
    string ClientName,
    string PickupWindow,
    string Days,
    DateTime? NextDue);

/// <summary>Create or replace-in-full payload. Empty BulkPolygonIds clears
/// all attached bulk polygons; omit the field entirely to keep them untouched.
/// ScheduleIds replaces the legacy single ScheduleId - empty list clears
/// all bound schedules.</summary>
public record UpsertRouteRequest(
    string Name,
    string Area,
    byte? DefaultTargetType,
    int? DefaultTargetId,
    List<int> ScheduleIds,
    bool Active,
    List<int> ZipPolygonIds,
    List<int>? BulkPolygonIds = null,
    // Feature 5.1. Defaulted so every existing caller and test keeps
    // compiling and keeps creating first-mile routes, which is what they
    // have always created.
    byte Direction = RouteDirections.FirstMile,
    int? DepotId = null,
    RouteOriginDto? Origin = null);

/// <summary>Copy an existing route's geometry + defaults into a new route.
/// Null ScheduleIds means "keep the source's schedules"; empty list means
/// "start with no schedules".</summary>
public record CopyRouteRequest(
    string Name,
    byte? DefaultTargetType,
    int? DefaultTargetId,
    List<int>? ScheduleIds,
    bool CopyZipcodes);

/// <summary>K6: one suggestion for the final-mile origin address box. Built
/// from pickup addresses this tenant has actually used, so the operator picks
/// instead of typing, and picks something already geocoded.
///
/// Coordinates come from the MOST RECENT job at that address rather than an
/// aggregate. Measured on medical-prod: the same company + zip carries several
/// different points across jobs, because a linehaul child leg stores its own
/// leg's pickup point rather than the family's. Averaging them would invent a
/// location that no job ever used; "where we collected from last time" is a
/// statement that can be checked.
///
/// UsageCount is how many non-void jobs share the address, so a one-off
/// mistyped address sorts below a real depot.</summary>
public record PickupAddressSuggestionDto(
    string Label,
    string? Company,
    string? Address,
    string? City,
    string? Zip,
    decimal? Latitude,
    decimal? Longitude,
    int UsageCount,
    DateTime? LastUsedUtc);

/// <summary>Autocomplete result for the zip search picker.</summary>
public record ZipcodeLookupDto(int ZipPolygonId, string Zip, decimal? Latitude, decimal? Longitude);

/// <summary>
/// One row of the recurring-route modal's Coverage lookup (polygons spec
/// part 1). Postcodes and custom polygons share a box now, so they share a
/// result shape: Kind tells the chip which colour and icon to use, and Id
/// means ZipPolygonId or PolygonId accordingly.
/// </summary>
public record CoverageLookupDto(
    /// <summary>"postcode" or "polygon".</summary>
    string Kind,
    int Id,
    string Label,
    /// <summary>Polygon's own colour, so the chip is visibly not a postcode.
    /// Null for postcodes.</summary>
    string ColorHex,
    decimal? Latitude,
    decimal? Longitude);

/// <summary>Segmented list of assignable targets (couriers / agents / NPs).</summary>
public record AssignableTargetDto(int Id, string Name, string Hint);
public record AssignableTargetsResponse(
    List<AssignableTargetDto> Couriers,
    List<AssignableTargetDto> Agents,
    List<AssignableTargetDto> Nps);

/// <summary>Roster entry attached to a route (Dispatch_RouteRoster row).</summary>
public record RouteRosterEntryDto(
    int RouteRosterId,
    int RouteId,
    byte? TargetType,
    int? TargetId,
    string TargetName,
    DateTime? RosterDate,
    byte? DayOfWeek,
    bool IsActive,
    DateTime CreatedAt);

/// <summary>Create a new roster entry. Exactly one of RosterDate / DayOfWeek must be set.</summary>
public record UpsertRouteRosterRequest(
    byte TargetType,
    int TargetId,
    DateTime? RosterDate,
    byte? DayOfWeek);

/// <summary>Schedule lookup entry - grouped from the one-row-per-weekday tblBulkRunSchedule.</summary>
public record ScheduleLookupDto(
    int Id,
    string Name,
    string StartTime,
    string EndTime,
    List<int> Days);

/// <summary>Full polygon shape for the map layer - one row per zip.</summary>
public record ZipPolygonShapeDto(
    int ZipPolygonId,
    string Zip,
    decimal? Latitude,
    decimal? Longitude,
    string Wkt);
