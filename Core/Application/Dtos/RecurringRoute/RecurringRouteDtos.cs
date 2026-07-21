namespace RoutedOperations.Core.Application.Dtos.RecurringRoute;

/// <summary>Zip code attached to a route (via the RouteZipcodes junction).</summary>
public record RouteZipcodeDto(int ZipPolygonId, string Zip);

/// <summary>
/// Read shape for a Route. Mirrors the Configurator TenantRouteDto contract
/// so operators moving between the two apps see identical fields.
/// TargetType: 1=Courier, 2=Agent, 3=NetworkPartner.
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
    bool Active,
    List<RouteZipcodeDto> Zipcodes,
    int RosterEntryCount,
    DateTime CreatedAt,
    DateTime? UpdatedAt);

/// <summary>Create or replace-in-full payload.</summary>
public record UpsertRouteRequest(
    string Name,
    string Area,
    byte? DefaultTargetType,
    int? DefaultTargetId,
    int? ScheduleId,
    bool Active,
    List<int> ZipPolygonIds);

/// <summary>Copy an existing route's geometry + defaults into a new route.</summary>
public record CopyRouteRequest(
    string Name,
    byte? DefaultTargetType,
    int? DefaultTargetId,
    int? ScheduleId,
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
