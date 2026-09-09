namespace RoutedOperations.Core.Application.Dtos.Schedule;

/// <summary>
/// A schedule "group" - all tblBulkRunSchedule rows sharing (Name, ClientId).
/// Each group holds N day-window entries (one per active day) plus a
/// shared template (region, speeds, postcode group, drop-off, etc.),
/// zone activations, linehaul legs, and the three new junction sets
/// (multi-client, individual postcodes, coverage polygons).
///
/// LegacyClientId is populated for pre-junction rows (where
/// tblBulkRunSchedule.ClientId is set). New groups leave it null and
/// use the tblScheduleClient junction (surfaced via ClientIds).
/// </summary>
public record ScheduleGroupDto(
    /// <summary>The header's BulkRunScheduleId (identity PK, one per schedule group). Introduced 2026-09-08. Frontend uses this as the schedule identity.</summary>
    int ScheduleId,
    string Name,
    int? LegacyClientId,
    /// <summary>Client code resolved from LegacyClientId (e.g. "ACME"). Null when LegacyClientId is null. Operators identify clients by code, not id.</summary>
    string LegacyClientCode,
    int RegionId,
    string RegionName,
    int? PickupDepotId,
    string PickupDepotName,
    int? SpeedId,
    string SpeedName,
    int? ParentSpeedId,
    string ParentSpeedName,
    int? PostcodeGroupId,
    string PostcodeGroupName,
    int? PickupPostcodeGroupId,
    string PickupPostcodeGroupName,
    int? PickupRatingSpeed,
    bool? AutoBook,
    bool? BookPickup,
    bool? ApplyPickupCutoff,
    int? PickupCutoff,
    int? StorageState,
    int? DeliveryState,
    int? PickupBoxDiscount,
    int? DropOffLocationId,
    string DropOffLocationName,
    string Description,
    List<DayWindowDto> DayWindows,
    List<ScheduleZoneDto> Zones,
    List<ScheduleLinehaulDto> Linehauls,
    /// <summary>Client ids bound via the new tblScheduleClient junction. Empty for legacy per-client groups.</summary>
    List<int> ClientIds,
    /// <summary>Client codes resolved from ClientIds. Same order. Missing codes render as "#{id}".</summary>
    List<string> ClientCodes,
    /// <summary>Individual postcodes bound via tblSchedulePostcode. Supplements PostcodeGroupId.</summary>
    List<int> PostcodeIds,
    /// <summary>Coverage polygons bound via tblSchedulePolygon.</summary>
    List<int> PolygonIds);

/// <summary>
/// A single day-window entry within a schedule group. One tblBulkRunSchedule
/// row = one day-window. Times are "HH:mm" strings; Active mirrors whether
/// the row exists (unchecking = delete on save).
/// </summary>
public record DayWindowDto(
    /// <summary>tblBulkRunSchedule.BulkRunScheduleId; null for a not-yet-persisted window.</summary>
    int? Id,
    /// <summary>1 = Monday, 7 = Sunday (ISO).</summary>
    short DayOfWeek,
    string StartTime,
    string EndTime,
    int CutoffHours);

public record ScheduleZoneDto(
    int Id,
    int? ScheduleId,
    int Zone,
    bool? Active);

/// <summary>Slim schedule-group projection for the Schedules tab list.
/// Carries just the columns the table renders (name / destination /
/// speed / day chips / counts / auto-book / linehaul yes-no). Full
/// junction ids and per-leg detail come via GetDetailAsync only when
/// the operator opens the edit modal - saves ~4s on the initial list
/// fetch versus loading every schedule's zones + linehauls + junctions
/// up-front.</summary>
public record ScheduleGroupSummaryDto(
    /// <summary>The header's BulkRunScheduleId (identity PK, one per schedule group). Introduced 2026-09-08. Frontend uses this as the schedule identity.</summary>
    int ScheduleId,
    string Name,
    int? LegacyClientId,
    string LegacyClientCode,
    int RegionId,
    string RegionName,
    int? SpeedId,
    string SpeedName,
    /// <summary>Active DayOfWeek values across the group (1=Mon..7=Sun),
    /// ordered ascending. Frontend renders the M-T-W-T-F-S-S chip strip
    /// from this set.</summary>
    int[] ActiveDays,
    int ActiveZonesCount,
    int ClientCount,
    int PostcodeCount,
    int PolygonCount,
    bool? AutoBook,
    bool HasActiveLinehaul,
    /// <summary>Up to 3 currently-linked client codes (sorted alphabetically)
    /// for the Schedules list row chip strip. Full count is `ClientCount`;
    /// if it exceeds 3 the row renders a `+N more` marker for the tail.
    /// Capped at 3 to keep payload small on default schedules that many
    /// clients bind to. LegacyClientCode is deliberately NOT shown by the
    /// row - kept on the DTO for backend reference only.</summary>
    string[] LinkedClientCodes);

public record ScheduleLinehaulDto(
    int Id,
    string Name,
    bool? Active,
    decimal? Amount,
    decimal? AmountPercentage,
    int? FromDepotId,
    int? ToDepotId,
    int? Minutes,
    int? LinehaulRunId,
    bool? InsertToBulk,
    bool? ApplyDiscount,
    bool? ApplyAddOnPercentage,
    int[] WeekDay,
    int? DepartureAdvanceDays,
    bool? FromClientAddress,
    int? DropOffLocationId);

/// <summary>
/// Bundled lookup payload for the schedule edit modal. One roundtrip
/// bootstraps every dropdown the form needs.
/// </summary>
public record ScheduleLookupsDto(
    List<LookupItemDto> Depots,
    List<LookupItemDto> Speeds,
    List<LookupItemDto> Couriers,
    List<LookupItemDto> Clients,
    List<DropOffLocationDto> DropOffLocations,
    List<PostcodeGroupLookupDto> PostcodeGroups,
    List<LinehaulRunDto> LinehaulRuns,
    List<int> ZoneNumbers,
    List<StateOptionDto> StorageStates,
    List<StateOptionDto> DeliveryStates,
    List<StateOptionDto> PickupBoxDiscounts);

public record LookupItemDto(int Id, string Name);
public record DropOffLocationDto(int Id, string Name, int DepotId);
public record PostcodeGroupLookupDto(int Id, string Name, int? DepotId, int? ClientId);
public record LinehaulRunDto(
    int Id,
    string RunName,
    int? FromDepotId,
    int? ToDepotId,
    string StartTime,
    string DespatchTime,
    int? CourierId);
public record StateOptionDto(int Id, string Label);
