#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// The physical day-row table, which dbmigrationsv2 20261009177000 renamed
/// from tblBulkRunSchedule to tblBulkRunScheduleDay and replaced in place
/// with a compatibility view of the old name.
///
/// WHY THIS EXISTS SEPARATELY FROM TblBulkRunSchedule
///
/// The view is not updatable (INFORMATION_SCHEMA reports IS_UPDATABLE = NO),
/// so nothing can be written through it. But the view is also the only
/// correct place to READ a day row from, because for a converted schedule
/// the payload columns on this table are NULL and the view synthesises them
/// from the detail row. One entity cannot be both, so:
///
///   TblBulkRunSchedule     -> the view. Every read. Mapped ToView, so a
///                             stray write fails loudly instead of silently
///                             targeting the wrong object.
///   TblBulkRunScheduleDay  -> this table. Every write.
///
/// The two carry the same 29 columns and the same ids, which is what lets
/// BulkZoneSchedule, TblBulkScheduleLinehaul, tblRouteSchedule and
/// ShopWindow keep their foreign keys through the rename.
///
/// On a converted schedule a row here is a KEY ROW: only Name, ClientId,
/// ScheduleId and DayOfWeek are set, and everything else is NULL by design.
/// Key rows are never deleted, because other tables hold their ids;
/// un-ticking a day clears the mask bit on the detail row instead.
/// </summary>
[Table("tblBulkRunScheduleDay")]
public class TblBulkRunScheduleDay
{
    /// <summary>
    /// Day-row PK, unchanged by the rename. This is the id ShopWindow,
    /// BulkZoneSchedule, TblBulkScheduleLinehaul and tblRouteSchedule
    /// reference, and the id the booking SPs pack into a quote, so it is a
    /// live external contract: never renumber it.
    /// </summary>
    public int BulkRunScheduleId { get; set; }

    /// <summary>FK to tblBulkRunScheduleHeader.ScheduleId.</summary>
    public int ScheduleId { get; set; }

    public virtual BulkRunScheduleHeader Header { get; set; }

    // ---- the four columns a key row carries ----------------------------

    public string Name { get; set; }

    /// <summary>smallint in the database, not int. NOT NULL here.</summary>
    public short DayOfWeek { get; set; }

    /// <summary>
    /// Legacy per-row client id, still written so anything reading it keeps
    /// working (Client Manager, the booking SPs). Distinct from the header's
    /// LegacyClientId, which is where it is copied from.
    /// </summary>
    public int? ClientId { get; set; }

    // ---- payload. NULL on a key row, set on an old-shape row -----------

    public TimeSpan? StartTime { get; set; }
    public TimeSpan? EndTime { get; set; }
    public int? MaxJobs { get; set; }
    public int? Region { get; set; }
    public int? SpeedId { get; set; }
    public int? CutoffHours { get; set; }
    public string Description { get; set; }
    public bool? AutoBook { get; set; }
    public int? PostcodeGroupId { get; set; }
    public bool? BookPickup { get; set; }
    public int? PickupDepotId { get; set; }
    public int? StorageState { get; set; }
    public int? DeliveryState { get; set; }
    public int? PickupRatingSpeed { get; set; }
    public int? PickupPostcodeGroupId { get; set; }
    public int? ParentSpeedId { get; set; }
    public int? PickupBoxDiscount { get; set; }

    /// <summary>Column is spelled DropOffLocationID in the database.</summary>
    [Column("DropOffLocationID")]
    public int? DropOffLocationId { get; set; }

    public bool? ApplyPickupCutoff { get; set; }
    public int? PickupCutoff { get; set; }
    public int? AutoBookScanAhead { get; set; }
    public bool? IsRecurringSchedule { get; set; }

    /// <summary>
    /// Absolute cutoff pair (F11 Phase C). On a converted schedule these are
    /// NULL here and the view derives them from the detail row's relative
    /// rule through dbo.fnCutoffDayFor and dbo.fnCutoffHoursFor.
    /// </summary>
    public byte? CutoffDay { get; set; }
    public TimeSpan? CutoffTime { get; set; }

    // ---- no child-row collections here, deliberately --------------------
    //
    // BulkZoneSchedule, BulkPickupZoneSchedule and TblBulkScheduleLinehaul
    // keep their navigations on TblBulkRunSchedule (the view), because every
    // READ Includes them from there. Mirroring them here was tried and
    // reverted on 2026-10-09: EF discovers such collections by convention
    // and mints a shadow FK per child, which is precisely the 2026-08-25
    // "Invalid column name 'TblBulkRunScheduleBulkRunScheduleId'" incident.
    // ScheduleModelShapeTests caught it within one run.
    //
    // So the write path sets the child rows' FK column directly, by day-row
    // id, through Context.BulkZoneSchedules and friends. That needs the day
    // rows to have ids before the children are added, which is why
    // UpsertAsync saves in two phases inside one transaction.
    //
    // Naming trap worth keeping in view: BulkZoneSchedule.ScheduleId and
    // BulkPickupZoneSchedule.ScheduleId hold a DAY-ROW id
    // (tblBulkRunScheduleDay.BulkRunScheduleId), not a header id, despite
    // the name. TblBulkScheduleLinehaul.BulkRunScheduleId is the same id
    // under its honest name.
}
