#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Per-client delta row against a schedule (Steve F1 2026-09-20). Replaces
/// the clone-based BaseScheduleId override model with a small delta table
/// that records only what one client has different from the schedule's
/// base values. Introduced 2026-09-22 by AddClientOverrideDeltas.
///
/// Scopes:
///   'schedule'    - fields that live on the schedule itself
///                   (CutoffHours, CutoffDay, CutoffTime, WeekDays,
///                    IsActive, DisplayName, DisplayDescription).
///   'collection'  - fields on the collection leg (SpeedId, ZoneGroupId,
///                   PickupTimeMode, PickupWindowStart, PickupWindowEnd,
///                   AdditionalItemChargingLogic).
///   'depot'       - reserved for depot-leg overrides (unused today).
///   'delivery'    - fields on the delivery leg (SpeedId, ZoneGroupId).
///
/// Every row must set at least one value (CK_..._NotEmpty). Schedule-
/// scope rows cannot carry leg fields and vice versa (CK_..._ScopeFields).
///
/// Resolution: dbo.fnScheduleForClient joins these rows to a schedule's
/// day rows via COALESCE per scope. Clustered on
/// (ScheduleId, ClientId, Scope, LegOrdinal, DayOfWeek) so every row a
/// client has on one schedule is physically adjacent.
///
/// LegOrdinal + DayOfWeek are always 0 today (hooks for per-repeat-leg
/// and per-day overrides without a future migration).
/// </summary>
[Table("tblBulkRunScheduleOverride")]
public class BulkRunScheduleOverride
{
    public int OverrideId { get; set; }

    /// <summary>FK to tblBulkRunScheduleHeader.ScheduleId.</summary>
    public int ScheduleId { get; set; }

    public int ClientId { get; set; }

    [MaxLength(12)]
    public string Scope { get; set; }

    public byte LegOrdinal { get; set; }

    public byte DayOfWeek { get; set; }

    // Schedule-scope columns (NULL = inherit from base)
    public int? CutoffHours { get; set; }
    public byte? CutoffDay { get; set; }
    public TimeSpan? CutoffTime { get; set; }

    [MaxLength(7)]
    public string WeekDays { get; set; }

    public bool? IsActive { get; set; }

    [MaxLength(200)]
    public string DisplayName { get; set; }

    [MaxLength(500)]
    public string DisplayDescription { get; set; }

    // Leg-scope columns (NULL = inherit from base)
    public int? SpeedId { get; set; }
    public int? ZoneGroupId { get; set; }

    [MaxLength(10)]
    public string PickupTimeMode { get; set; }

    public TimeSpan? PickupWindowStart { get; set; }
    public TimeSpan? PickupWindowEnd { get; set; }

    [MaxLength(40)]
    public string AdditionalItemChargingLogic { get; set; }

    public DateTime CreatedUtc { get; set; }

    [MaxLength(100)]
    public string CreatedBy { get; set; }

    public DateTime? UpdatedUtc { get; set; }

    [MaxLength(100)]
    public string UpdatedBy { get; set; }

    // Convenience scope constants for services that build these rows.
    public const string ScopeSchedule   = "schedule";
    public const string ScopeCollection = "collection";
    public const string ScopeDepot      = "depot";
    public const string ScopeDelivery   = "delivery";
}
