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
    public List<ScheduleZoneUpsertRequest> Zones { get; set; } = new();
    public List<ScheduleLinehaulUpsertRequest> Linehauls { get; set; } = new();
    /// <summary>Clients this schedule applies to (M:N via tblScheduleClient).
    /// Preferred path: pass ClientCodes below. If both are provided,
    /// ClientCodes wins after server-side resolve.</summary>
    public List<int> ClientIds { get; set; } = new();
    /// <summary>Client codes (operator-facing, e.g. "ACME"). Resolved to
    /// ClientIds server-side and merged in. Unknown codes throw.</summary>
    public List<string> ClientCodes { get; set; } = new();
    /// <summary>Individual postcodes bound to this schedule (M:N via tblSchedulePostcode).</summary>
    public List<int> PostcodeIds { get; set; } = new();
    /// <summary>Coverage polygons bound to this schedule (M:N via tblSchedulePolygon).</summary>
    public List<int> PolygonIds { get; set; } = new();
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
    [Required, StringLength(200)] public string SourceName { get; set; } = string.Empty;
    /// <summary>Null = the default (junction-based) source group. Set = a legacy per-client override source.</summary>
    public int? SourceLegacyClientId { get; set; }
    [Required, StringLength(200)] public string NewName { get; set; } = string.Empty;
    /// <summary>Client codes (preferred). Resolved server-side to ClientIds and bound via the junction.</summary>
    public List<string> ClientCodes { get; set; } = new();
    /// <summary>Legacy id-based path. If ClientCodes is non-empty, it wins.</summary>
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
}
