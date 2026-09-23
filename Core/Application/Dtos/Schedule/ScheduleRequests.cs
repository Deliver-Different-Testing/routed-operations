using System.ComponentModel.DataAnnotations;

namespace RoutedOperations.Core.Application.Dtos.Schedule;

/// <summary>
/// Request body for POST /api/schedules and PUT /api/schedules/{name}.
/// A schedule group is identified by Name. Save syncs:
///   * N tblBulkRunSchedule rows against the DayWindows array
///     (insert new, update existing by Id, delete rows not in the array)
///   * The three junctions (client / postcode / polygon) against the
///     three id-list arrays
///   * BulkZoneSchedule + TblBulkScheduleLinehaul as before
///
/// LegacyClientId is a read-only echo of the current group's per-row
/// ClientId (nullable). Rewriting it isn't supported here; to migrate
/// a legacy per-client group to the new junction pattern, save under a
/// new name and delete the old.
/// </summary>
public class ScheduleGroupUpsertRequest
{
    /// <summary>
    /// Existing header id when updating; null when creating a new group.
    /// Introduced 2026-09-08 alongside the header table. Present = update
    /// path (loads header, syncs day rows via header FK, renames header
    /// Name if needed). Absent = create path (fresh IsDefault=1 header +
    /// day rows).
    /// </summary>
    public int? ScheduleId { get; set; }
    [Required, StringLength(200)] public string Name { get; set; } = string.Empty;
    public string Description { get; set; }
    [Required] public int RegionId { get; set; }
    public int? PickupDepotId { get; set; }
    public int? SpeedId { get; set; }
    public int? ParentSpeedId { get; set; }
    public bool? AutoBook { get; set; }
    public bool? BookPickup { get; set; }
    public bool? ApplyPickupCutoff { get; set; }
    public int? PickupCutoff { get; set; }
    public int? PostcodeGroupId { get; set; }
    public int? PickupPostcodeGroupId { get; set; }
    public int? PickupRatingSpeed { get; set; }
    public int? StorageState { get; set; }
    public int? DeliveryState { get; set; }
    public int? PickupBoxDiscount { get; set; }
    public int? DropOffLocationId { get; set; }
    public List<DayWindowUpsertRequest> DayWindows { get; set; } = new();
    /// <summary>F7 preservation (Steve 2026-09-20): nullable so an absent
    /// or explicit-null field is distinguishable from an explicit empty
    /// array. Null = "leave existing zones alone"; [] = "clear all zones";
    /// [...] = "replace". Prior shape (non-nullable List with = new()
    /// default) coerced absent to [], wiping live zone rows on saves that
    /// did not repopulate them.</summary>
    public List<ScheduleZoneUpsertRequest>? Zones { get; set; }
    /// <summary>F7 preservation (Steve 2026-09-20): see Zones. Same
    /// null-vs-empty semantics.</summary>
    public List<ScheduleLinehaulUpsertRequest>? Linehauls { get; set; }
    /// <summary>Legacy id-based fallback. Only consulted when ClientCodes
    /// is absent (null) from the request payload - i.e. an API caller that
    /// does not have code strings handy. Operator writes from the React UI
    /// always send ClientCodes and this field is ignored.
    /// Nullable so binding an absent JSON field stays null (fall-through
    /// to this path); an explicit empty array reads as "no clients".</summary>
    public List<int>? ClientIds { get; set; }
    /// <summary>Operator-facing path AND authoritative desired set. When
    /// present in the payload (non-null, even as an empty array) this
    /// REPLACES the client link set wholesale - anything not in this array
    /// is unbound. Chip picker toggles by code. Unknown codes throw.
    /// Nullable so an absent JSON field remains null and the ClientIds
    /// fallback fires; explicit empty means "no clients".</summary>
    public List<string>? ClientCodes { get; set; }
    /// <summary>Individual postcodes bound to this schedule (M:N via tblSchedulePostcode).</summary>
    public List<int> PostcodeIds { get; set; } = new();
    /// <summary>Coverage polygons bound to this schedule (M:N via tblSchedulePolygon).</summary>
    public List<int> PolygonIds { get; set; } = new();
    /// <summary>Client-facing display name shown on the customer booking
    /// page. Empty string from the form is normalised to NULL on write so
    /// "cleared" and "unset" are distinguishable. Added 2026-09-22 (Steve F13).</summary>
    public string DisplayName { get; set; }
    /// <summary>Long-form description that pairs with DisplayName on the
    /// customer booking page. Empty string normalises to NULL on write.
    /// Added 2026-09-22 (Steve F13).</summary>
    public string DisplayDescription { get; set; }
    /// <summary>Whether the schedule can be booked at all (independent of
    /// AutoBook). Optional; unset defaults to true on both create and
    /// update paths so callers that don't know about the field keep the
    /// pre-F21 behaviour. Added 2026-09-22 (Steve F21).</summary>
    public bool? IsActive { get; set; }
}

/// <summary>
/// Copy a schedule group. Source is identified by (SourceName +
/// SourceLegacyClientId). New group's identity: (NewName + LegacyClientId=null,
/// clients bound via the junction from ClientIds / ClientCodes).
///
/// Everything else - day-windows, zones, linehauls, polygon bindings,
/// individual postcode bindings - is duplicated verbatim. The new group
/// starts owning its own copies so subsequent edits on either don't leak
/// across.
/// </summary>
public class ScheduleCopyRequest
{
    /// <summary>
    /// Preferred: source header id (from ScheduleGroupDto.ScheduleId). If set,
    /// SourceName + SourceLegacyClientId below are ignored. Introduced
    /// 2026-09-08 alongside the header table.
    /// </summary>
    public int? SourceScheduleId { get; set; }
    /// <summary>Legacy tuple fallback (Name + LegacyClientId) - retained for one release.</summary>
    [StringLength(200)] public string SourceName { get; set; } = string.Empty;
    /// <summary>Null = the default source group. Set = a legacy per-client override source.</summary>
    public int? SourceLegacyClientId { get; set; }
    [Required, StringLength(200)] public string NewName { get; set; } = string.Empty;
    /// <summary>Client codes for the copy's new client link set. Empty
    /// AND ClientIds empty = inherit source's junction (per CopyAsync's
    /// three-tier resolver). Non-empty resolves each code -> id, throws on
    /// unknown.</summary>
    public List<string> ClientCodes { get; set; } = new();
    /// <summary>Client ids for the copy. Empty AND ClientCodes empty =
    /// inherit source's junction. Non-empty takes priority over the
    /// inherit branch when ClientCodes is empty.</summary>
    public List<int> ClientIds { get; set; } = new();
}

public class DayWindowUpsertRequest
{
    /// <summary>Existing BulkRunScheduleId; null for a fresh window.</summary>
    public int? Id { get; set; }
    /// <summary>1 = Monday, 7 = Sunday (ISO).</summary>
    public short DayOfWeek { get; set; }
    /// <summary>"HH:mm" e.g. "08:30". Required.</summary>
    [Required] public string StartTime { get; set; } = string.Empty;
    [Required] public string EndTime { get; set; } = string.Empty;
    public int CutoffHours { get; set; }
}

public class ScheduleZoneUpsertRequest
{
    public int Zone { get; set; }
    public bool? Active { get; set; }
}

public class ScheduleLinehaulUpsertRequest
{
    public string Name { get; set; }
    public bool? Active { get; set; }
    public decimal? Amount { get; set; }
    public decimal? AmountPercentage { get; set; }
    public int? FromDepotId { get; set; }
    public int? ToDepotId { get; set; }
    public int? Minutes { get; set; }
    public int? LinehaulRunId { get; set; }
    public bool? InsertToBulk { get; set; }
    public bool? ApplyDiscount { get; set; }
    public bool? ApplyAddOnPercentage { get; set; }
    public int[] WeekDay { get; set; } = new[] { 0, 0, 0, 0, 0, 0, 0 };
    public int? DepartureAdvanceDays { get; set; }
    public bool? FromClientAddress { get; set; }
    public int? DropOffLocationId { get; set; }
    /// <summary>Per-leg service class override. Null = inherit from run / schedule.</summary>
    public int? SpeedId { get; set; }
}
