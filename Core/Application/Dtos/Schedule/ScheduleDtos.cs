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
    /// <summary>'depot' or 'client'. 'client' means the chain starts at the
    /// client's own address: no collection job, and the booking's own From
    /// address survives instead of being replaced by a depot's. Stored on
    /// tblBulkRunScheduleHeader (schedule-origin spec 5.1).</summary>
    string OriginType,
    /// <summary>Origin branch for a client-origin schedule. Counterpart of
    /// PickupDepotId, not of RegionId: RegionId stays the delivery branch.
    /// Null for depot-origin schedules.</summary>
    int? OriginRegionId,
    /// <summary>Name of OriginRegionId resolved from tblBulkRegion.</summary>
    string OriginRegionName,
    /// <summary>
    /// Names of this schedule's linked clients that have no site coordinates
    /// (schedule-origin spec 4.5). Only meaningful when OriginType is
    /// 'client': a client-origin run starts at the client's site, so without
    /// coordinates it starts in the wrong place. Always empty for depot
    /// origin, which never reads the client's site.
    ///
    /// A warning, not a block: the booking path still works from the address
    /// the booking itself carries.
    /// </summary>
    List<ClientGeocodeGapDto> ClientsMissingGeocode,
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
    /// <summary>Zones the collection leg collects from. Empty on every
    /// schedule until the Collection card starts writing them.</summary>
    List<ScheduleZoneDto> PickupZones,
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
    bool IsActive,
    /// <summary>
    /// True when this schedule has been collapsed onto a single detail row,
    /// which is to say it has a tblBulkRunScheduleDetail row. Its day rows
    /// are then key rows carrying no payload, and everything in this DTO
    /// comes from the detail row by way of the compatibility view.
    ///
    /// False is not a problem to fix: an old-shape schedule is correct and
    /// bookable. Schedules collapse opportunistically, when someone saves
    /// one and its days agree, so the estate converges without a campaign.
    /// Worth showing in the UI only so ops can see that happening.
    /// </summary>
    bool IsCollapsed,
    /// <summary>
    /// How many upcoming runs the booking page offers. Null on an old-shape
    /// schedule, which has nowhere to store it and falls back to one week's
    /// worth. A per-client override can raise or lower it; that lives on the
    /// client's override row, not here.
    /// </summary>
    byte? OccurrencesAhead,
    /// <summary>
    /// Why the last save did NOT collapse this schedule, verbatim from
    /// dbo.uspScheduleConvert, or null when it did collapse or the question
    /// has not been asked. Reasons are semicolon-separated and name the
    /// obstacle: WindowVariesByDay, PayloadVaries:&lt;column&gt;,
    /// CutoffDayNotExpressible, ShopWindowReferenced:&lt;shop&gt;. Observed
    /// verbatim from a save on a real database, not translated here, so the
    /// operator sees the actual obstacle.
    ///
    /// Only populated on the DTO a save returns. A plain GET leaves it null,
    /// because the question "why did it not convert" is only meaningful
    /// about an attempt that just happened.
    /// </summary>
    string ConvertRefusalReasons,
    /// <summary>
    /// True when every client can book this schedule, straight off
    /// tblBulkRunScheduleHeader.IsDefault. It is an explicit setting on the
    /// header, NOT a derived "has no link rows": the two came apart as soon
    /// as the Clients tab could attach a client to a default, and the modal
    /// used to infer it from ClientIds.Count, which is why its radio pair
    /// read the wrong way round on a default that had a client configured
    /// (spec 6.1, Steve 2026-10-16).
    ///
    /// Optional with a true default so a positional caller written before
    /// 6.1 still compiles and keeps the pre-6.1 reading.
    /// </summary>
    bool IsDefault = true);

/// <summary>
/// One run the booking page would offer, for the preview under the
/// "occurrences ahead" field. NOT a booking and not persisted: it answers
/// "if N were this, which dates would a client see".
/// </summary>
public record ScheduleOccurrenceDto(
    /// <summary>Local date of the run, ISO yyyy-MM-dd.</summary>
    string Date,
    /// <summary>1 = Monday .. 7 = Sunday, matching the day rows.</summary>
    int DayOfWeek,
    /// <summary>Run start, "HH:mm". The window the day opens.</summary>
    string StartTime,
    /// <summary>
    /// When ordering closes for this run, "yyyy-MM-dd HH:mm".
    ///
    /// F23 (Anisah's 14 to 16 Oct smoke test): this now uses the SAME
    /// expression as UTL_fncJob_GetClientAvailableBulkRunSchedule, which is
    /// the absolute CutoffDay / CutoffTime pair where the schedule has one
    /// and StartTime minus CutoffHours where it does not. It previously only
    /// ever did the second, so a schedule with a day-before absolute cutoff
    /// previewed a date the booking page had already closed. #713 KSFRS was
    /// the clearest case: cutoff 17:00 the day before, tested at 18:15 on a
    /// Thursday, preview started Friday and the booking page started Monday.
    /// </summary>
    string CutoffAt,
    /// <summary>
    /// The tenant-local moment the cutoff test was applied, "yyyy-MM-dd HH:mm".
    ///
    /// Same on every row of one response, which is redundant but keeps this
    /// additive: a wrapper object would have broken the service, the hook and
    /// the component for what is a label. It is here because the list is only
    /// true as at a moment, and the operator's own clock is not necessarily
    /// the tenant's, which is the mistake this item fixed on the server side.
    /// </summary>
    string AsAt);

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
    /// <summary>F11 Phase C (2026-09-24). Absolute cutoff day-of-week
    /// (1=Mon..7=Sun). NULL when the row still uses the legacy CutoffHours
    /// offset; tenant SPs coalesce this over CutoffHours.</summary>
    int? CutoffDay,
    /// <summary>F11 Phase C (2026-09-24). Absolute cutoff wall-clock time
    /// as "HH:mm". NULL when the row still uses the legacy CutoffHours
    /// offset.</summary>
    string CutoffTime);

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
    bool IsActive,
    /// <summary>One row per override client on this schedule (2026-09-24
    /// Steve). Each row carries the delta labels that describe how the
    /// client's overrides diverge from the base schedule ("Cut-off Fri
    /// 13:00 (base Fri 15:00)", etc). Empty when the schedule has no
    /// overrides. Rendered as nested rows under the base in the Schedules
    /// NEW list view. Appended so positional callers don't break.</summary>
    List<ScheduleOverrideRowDto> Overrides,
    /// <summary>True when the schedule has been collapsed onto a single
    /// detail row. See ScheduleGroupDto.IsCollapsed; this is the same flag on
    /// the list row so ops can see the estate converging.</summary>
    bool IsCollapsed,
    /// <summary>How many upcoming runs the booking page offers, or null on an
    /// old-shape schedule. See ScheduleGroupDto.OccurrencesAhead.</summary>
    byte? OccurrencesAhead,
    /// <summary>'depot', 'client' or 'direct', straight off
    /// tblBulkRunScheduleHeader.OriginType. The Schedules NEW list needs it
    /// for the ORIGIN column: PickupDepotName is NULL for BOTH 'client' and
    /// 'direct', so the column cannot tell them apart without this.
    /// Last because it is the only optional parameter; IsCollapsed and
    /// OccurrencesAhead landed in the same release and sit ahead of it.</summary>
    string OriginType = "depot",
    /// <summary>
    /// Header IsDefault. The list row's client chip and the type= filter both
    /// read this rather than inferring a default from ClientCount == 0, which
    /// mislabelled every default that had a client configured on it (spec
    /// 6.1). Optional so positional callers keep compiling.
    /// </summary>
    bool IsDefault = true);

/// <summary>
/// One nested override-row entry under a base schedule in the Schedules
/// NEW list view. One row per client that owns any delta on the schedule.
/// The DeltaLabels array describes each scope+field difference in a
/// human-readable form ("Cut-off Fri 13:00 (base Fri 15:00)",
/// "Delivery speed Overnight (base Standard)", ...) so the operator can
/// see what this client differs on without opening the editor. Added
/// 2026-09-24 (Steve nested-override brief).
/// </summary>
public record ScheduleOverrideRowDto(
    int ClientId,
    string ClientCode,
    string ClientName,
    string[] DeltaLabels);

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
/// One member schedule inside a bundle, for the bundle modal (Steve
/// 2026-10-16, SCHEDULE-BUNDLES-UI-2026-10-16). Carries enough to render
/// the member row without a second fetch.
/// </summary>
public record ScheduleBundleMemberDto(
    int ScheduleId,
    string Name,
    bool IsDefault,
    /// <summary>tblScheduleClient rows on this member. Not necessarily 0 on a
    /// default: since spec 6.1 a client can be configured on a schedule every
    /// client can book. The bundle's own client count still skips defaults;
    /// see ListBundleDetailAsync for why.</summary>
    int ClientCount,
    /// <summary>Delivery depot of the first day row (tblBulkRunSchedule.Region).</summary>
    string RegionName,
    /// <summary>Delivery speed of the first day row.</summary>
    string SpeedName,
    /// <summary>Active DayOfWeek values (1=Mon..7=Sun), ascending.</summary>
    int[] ActiveDays);

/// <summary>
/// One client "on the bundle": linked to at least one non-default member.
/// OnMembers / OfMembers show partial coverage (a client attached before a
/// schedule joined the bundle) so the modal can offer "Complete".
/// </summary>
public record ScheduleBundleClientDto(
    int ClientId,
    string Code,
    string Name,
    int OnMembers,
    int OfMembers);

/// <summary>GET /api/v2/schedule-bundles/{id} payload for the bundle modal.</summary>
public record ScheduleBundleDetailDto(
    int BundleId,
    string Name,
    string Description,
    bool IsActive,
    List<ScheduleBundleMemberDto> Members,
    List<ScheduleBundleClientDto> Clients);

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
    string SpeedName,
    /// <summary>
    /// 1-based travel order within the schedule. NULL means the chain was
    /// never ordered (or was ambiguous at backfill time) and the booking SPs
    /// fall back to Id order. The list is returned in this order, so the
    /// chain editor renders legs in travel order.
    /// </summary>
    int? LegOrder);

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

/// <summary>
/// A linked client with no site coordinates. Carries the id as well as the
/// name so the warning can offer to geocode that client directly rather than
/// sending the operator off to find it (schedule-origin spec 4.5).
/// </summary>
public record ClientGeocodeGapDto(int ClientId, string ClientName);
