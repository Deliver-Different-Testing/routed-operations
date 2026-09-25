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
    List<int> PolygonIds,
    /// <summary>tblScheduleClient.CreatedUtc for each ClientId, parallel-indexed. Null when the link row lacks a timestamp (legacy backfill rows). Feeds the "since YYYY-MM-DD" hint on the Clients tab per Steve's mockup.</summary>
    List<DateTime?> ClientLinkedUtcs,
    /// <summary>Full client name (tucClient.UcclName) resolved from ClientIds. Same order. Null when the client lacks a name. Renders as the first column in the Attached Clients row per Steve's mockup: "Full Name . CODE . id".</summary>
    List<string> ClientNames,
    /// <summary>Client-facing display name shown on booking / job pages.
    /// NULL falls back to Name. Added 2026-09-22 (Steve F13).</summary>
    string DisplayName,
    /// <summary>Long-form description that pairs with DisplayName on the
    /// customer booking page. Added 2026-09-22 (Steve F13).</summary>
    string DisplayDescription,
    /// <summary>True if this schedule can be booked at all. Separate from
    /// AutoBook (which controls book-immediately vs stage). Added
    /// 2026-09-22 (Steve F21).</summary>
    bool IsActive);

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
    string[] LinkedClientCodes,
    /// <summary>Self-FK from tblBulkRunScheduleHeader. Non-null on
    /// override headers, pointing at the base they refine. NULL on
    /// default and shared headers. The Schedules NEW view nests
    /// override rows under their base by grouping on this. Ships as
    /// null on every row until the 20260914140000 migration applies;
    /// legacy consumers keep working because they never read the
    /// field.</summary>
    int? BaseScheduleId,
    /// <summary>Free-text description carried on any day row of the
    /// group. Rendered as the small-print subtitle under Name.</summary>
    string Description,
    /// <summary>Origin depot id (from tblBulkRunSchedule.PickupDepotId).
    /// Null = pickup from client address.</summary>
    int? PickupDepotId,
    /// <summary>Origin depot name resolved from tblBulkRegion. Null
    /// when PickupDepotId is null (rendered as "Client address").</summary>
    string PickupDepotName,
    /// <summary>Window start time in "HH:mm" - lowest StartTime across
    /// all day rows.</summary>
    string WindowStart,
    /// <summary>Window end time in "HH:mm" - highest EndTime across
    /// all day rows.</summary>
    string WindowEnd,
    /// <summary>Monday cut-off hours (day-of-week = 1). Null if the
    /// schedule doesn't run on Monday.</summary>
    int? MonCutoffHours,
    /// <summary>Cut-off for the other operating days (Tue-Sun). Set to
    /// the mode of the non-Monday cutoffs so Steve's "65/17h" split
    /// renders cleanly. Null when the schedule only runs on Monday
    /// or every day has the same cutoff as Monday.</summary>
    int? OtherCutoffHours,
    /// <summary>Count of override headers pointing at this ScheduleId.
    /// Rendered inline with Name as "+N" when > 0.</summary>
    int OverrideCount,
    /// <summary>Recurring routes bound to any day row of this group
    /// via tblRouteSchedule. Rendered as a blue "N routes" chip when
    /// > 0.</summary>
    int RouteCount,
    /// <summary>Compact linehaul summary. Example "LH AUC-CHR 21:30".
    /// Null when the schedule has no active linehaul leg. Picks the
    /// first active linehaul row for stable display.</summary>
    string LinehaulHint,
    /// <summary>Field names on this override that differ from its base
    /// schedule. Empty when this row is not an override (BaseScheduleId
    /// is null) or when the override matches its base verbatim on every
    /// scoped field. Powers the "differs on: Cut-off, Speed" hint under
    /// the nested override row per Steve's brief §2 Schedules-tab item
    /// "the fields that differ".</summary>
    string[] OverriddenFields,
    /// <summary>Client-facing display name (Steve F13, 2026-09-22).
    /// NULL falls back to Name.</summary>
    string DisplayName,
    /// <summary>Long-form description that pairs with DisplayName on the
    /// customer booking page (Steve F13, 2026-09-22).</summary>
    string DisplayDescription,
    /// <summary>True if this schedule can be booked at all. Independent of
    /// AutoBook (which is book-immediately vs stage). Steve F21,
    /// 2026-09-22.</summary>
    bool IsActive);

/// <summary>
/// One schedule bundle (Dane's bundle-of-schedules concept). Row shape
/// for the Schedules NEW Bundles tab. Client counts are aggregated
/// across every non-default member schedule so operators see the
/// "total clients this bundle touches" chip up front.
/// Added 2026-09-14 alongside AddBaseScheduleIdAndScheduleGroupTables;
/// renamed 2026-09-22 by RenameScheduleGroupToBundle per Steve F18.
/// </summary>
public record ScheduleBundleDto(
    int BundleId,
    string Name,
    string Description,
    bool IsActive,
    int ScheduleCount,
    int ClientCount,
    /// <summary>ScheduleIds of the bundle's members in ID order.</summary>
    int[] ScheduleIds,
    /// <summary>Names of the bundle's members in ID order. Same length as
    /// ScheduleIds. Useful for the Bundles tab expanded-row chips.</summary>
    string[] ScheduleNames);

/// <summary>
/// One row of "the schedules this client can actually book" per Steve's
/// brief §5 resolution rule. Source tag lets the frontend tag each row
/// in the View-as-client view: "override" = the client owns this
/// override header; "shared" = the client is linked to a shared
/// (non-default) header; "default" = fallback because the client has
/// no link rows and no override.
/// </summary>
public record ClientScheduleDto(
    int ScheduleId,
    string Name,
    string Source);

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
    int? DropOffLocationId,
    int? SpeedId,
    string SpeedName);

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
