namespace RoutedOperations.Core.Application.Dtos.RecurringRoute;

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
    DateTime? UpdatedAt);

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
    List<int>? BulkPolygonIds = null);

/// <summary>Copy an existing route's geometry + defaults into a new route.
/// Null ScheduleIds means "keep the source's schedules"; empty list means
/// "start with no schedules".</summary>
public record CopyRouteRequest(
    string Name,
    byte? DefaultTargetType,
    int? DefaultTargetId,
    List<int>? ScheduleIds,
    bool CopyZipcodes);

/// <summary>Autocomplete result for the zip search picker.</summary>
public record ZipcodeLookupDto(int ZipPolygonId, string Zip, decimal? Latitude, decimal? Longitude);

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
