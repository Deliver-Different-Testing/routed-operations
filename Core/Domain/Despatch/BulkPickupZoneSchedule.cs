#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Pickup-side twin of <see cref="BulkZoneSchedule"/>: the zones a schedule's
/// collection leg collects from, one row per (day row, zone).
///
/// The table has existed for a while but was never written or read: 0 rows
/// and 0 referencing modules on every tenant as at 2026-10-07. Schedules NEW
/// starts populating it with the Collection card rebuild (Steve's
/// schedule-origin spec 3.2); the availability functions consume it when the
/// zone functions are extracted (polygons spec 3.3), so until then these are
/// stored picks that change no booking behaviour.
///
/// Why it matters beyond parity: without a way to pick zone numbers on the
/// pickup side, a pickup zone group was the only way to say "this schedule
/// collects from a subset of zones". Once these rows exist, those groups
/// collapse into the depot default group.
///
/// ScheduleId is the DAY ROW id (tblBulkRunSchedule.BulkRunScheduleId), the
/// same key BulkZoneSchedule uses, not the header's ScheduleId.
/// </summary>
[Table("BulkPickupZoneSchedule")]
public partial class BulkPickupZoneSchedule
{
    public int Id { get; set; }

    public int Zone { get; set; }

    public int ScheduleId { get; set; }

    public bool Active { get; set; } = true;

    public virtual TblBulkRunSchedule Schedule { get; set; }
}
