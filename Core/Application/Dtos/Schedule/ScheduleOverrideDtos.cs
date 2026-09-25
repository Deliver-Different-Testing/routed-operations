namespace RoutedOperations.Core.Application.Dtos.Schedule;

/// <summary>
/// One client's full set of overrides against a schedule. Groups the delta
/// rows returned from tblBulkRunScheduleOverride into three optional scope
/// blocks so the frontend can render a single "what does this client
/// differ on" panel per client. Every scope block is nullable and every
/// field within a scope is nullable - the shape is exactly the columns
/// the delta table stores, with NULL meaning "inherit from base".
///
/// A client with no overrides on a schedule returns no row at all
/// (the /overrides endpoint filters out clients with zero delta rows).
///
/// Steve F1 (2026-09-20), backed by tblBulkRunScheduleOverride shipped
/// 2026-09-22 by AddClientOverrideDeltas.
/// </summary>
public record ScheduleOverrideDto(
    int ScheduleId,
    int ClientId,
    string ClientCode,
    string ClientName,
    ScheduleScopeOverrideDto Schedule,
    LegScopeOverrideDto Collection,
    LegScopeOverrideDto Delivery,
    DateTime UpdatedUtc,
    string UpdatedBy);

/// <summary>
/// Schedule-scope override fields (cut-off + weekdays + display copy).
/// Every field is nullable: NULL means "inherit". A wholly-null instance
/// is the client having no schedule-scope delta row.
/// </summary>
public record ScheduleScopeOverrideDto(
    int? CutoffHours,
    int? CutoffDay,
    string CutoffTime,
    string WeekDays,
    bool? IsActive,
    string DisplayName,
    string DisplayDescription);

/// <summary>
/// Leg-scope override fields (used for both collection and delivery legs).
/// Every field is nullable. A wholly-null instance is the client having
/// no delta row for that leg role.
/// </summary>
public record LegScopeOverrideDto(
    int? SpeedId,
    int? ZoneGroupId,
    string PickupTimeMode,
    string PickupWindowStart,
    string PickupWindowEnd,
    string AdditionalItemChargingLogic);

/// <summary>
/// Request body for PUT /api/v2/schedules/{scheduleId}/overrides/{clientId}.
/// Full replace of that client's delta, all three scopes in one call.
///
/// Contract per Steve F1:
///   - A wholly-null scope object deletes that scope's row.
///   - An empty payload (every scope null / every field null in every
///     scope) deletes the client's override entirely.
///   - A field set to null clears just that field (returns to base value).
///   - A field set to a value overrides the base value.
///   - 400 on any leg scope the schedule does not have; 400 on
///     schedule-scope fields inside a leg scope and vice versa.
/// </summary>
public record ScheduleOverridePutRequest(
    ScheduleScopeOverrideDto Schedule,
    LegScopeOverrideDto Collection,
    LegScopeOverrideDto Delivery);

/// <summary>
/// Compact row for GET /api/v2/clients/{clientId}/overrides. Every schedule
/// this client differs on, with the scopes that are set. Feeds the client's
/// "you differ from N schedules on..." view that is impossible today
/// without opening every schedule.
/// </summary>
public record ClientOverrideRefDto(
    int ScheduleId,
    string ScheduleName,
    string[] Scopes,
    DateTime UpdatedUtc);
