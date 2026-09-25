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
    /// Per-schedule zone activation rows. One row per (Zone, Active)
    /// pairing for this schedule. Wired in DespatchContext (see the
    /// TblBulkRunSchedule OnModelCreating block).
    /// </summary>
    public virtual ICollection<BulkZoneSchedule> BulkZoneSchedules { get; set; } = new List<BulkZoneSchedule>();

    /// <summary>
    /// Per-schedule linehaul legs. Reciprocal of
    /// TblBulkScheduleLinehaul.BulkRunSchedule (declared in the
    /// RecurringLinehaul partial).
    /// </summary>
    public virtual ICollection<TblBulkScheduleLinehaul> TblBulkScheduleLinehauls { get; set; } = new List<TblBulkScheduleLinehaul>();
}
