#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Extra fields on tblBulkRunSchedule that the Schedules module (nightly
/// booking template surface) needs, kept in a separate partial. The
/// existing partials (base, Entities.BulkImport.cs,
/// BulkImportEntityExtensions.cs) already declare CutoffHours,
/// PostcodeGroupId, PickupDepotId, DropOffLocationId, StorageState,
/// DeliveryState, RegionNavigation - do NOT redeclare them here.
/// Related-entity names come from dictionary lookups in ScheduleService
/// rather than nav properties, so no additional Fluent config is needed.
/// </summary>
public partial class TblBulkRunSchedule
{
    public int MaxJobs { get; set; }
    public string Description { get; set; }
    public int? PickupRatingSpeed { get; set; }
    public int? PickupPostcodeGroupId { get; set; }
    public int? ParentSpeedId { get; set; }
    public int? PickupBoxDiscount { get; set; }

    /// <summary>
    /// Absolute cutoff pair (F11 Phase C, 2026-09-24). Day-of-week 1-7
    /// (Mon..Sun) plus wall-clock time. NULL on both = fall back to the
    /// legacy CutoffHours integer offset (BulkImportEntityExtensions.cs).
    /// Populated on write alongside CutoffHours so legacy consumers keep
    /// working; the tenant SPs coalesce the new pair over the old field.
    /// </summary>
    public byte? CutoffDay { get; set; }
    public TimeSpan? CutoffTime { get; set; }

    /// <summary>
    /// Per-schedule zone activation rows. One row per (Zone, Active)
    /// pairing for this schedule. Wired in DespatchContext (see the
    /// TblBulkRunSchedule OnModelCreating block).
    /// </summary>
    public virtual ICollection<BulkZoneSchedule> BulkZoneSchedules { get; set; } = new List<BulkZoneSchedule>();

    /// <summary>Pickup-side zones (schedule-origin spec 3.2). Mirrors
    /// BulkZoneSchedules; written by Schedules NEW's Collection card.</summary>
    public virtual ICollection<BulkPickupZoneSchedule> BulkPickupZoneSchedules { get; set; } = new List<BulkPickupZoneSchedule>();

    /// <summary>
    /// Per-schedule linehaul legs. Reciprocal of
    /// TblBulkScheduleLinehaul.BulkRunSchedule (declared in the
    /// RecurringLinehaul partial).
    /// </summary>
    public virtual ICollection<TblBulkScheduleLinehaul> TblBulkScheduleLinehauls { get; set; } = new List<TblBulkScheduleLinehaul>();
}
