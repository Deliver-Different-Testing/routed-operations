#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Schedule configuration for recurring bulk jobs. One row per schedule name +
/// day-of-week + client + speed + region. Route Builder reads StartTime/EndTime
/// to compute the Delivery Window a run must fit inside.
/// </summary>
[Table("tblBulkRunSchedule")]
public partial class TblBulkRunSchedule
{
    [Column("BulkRunScheduleId")]
    public int BulkRunScheduleId { get; set; }

    /// <summary>
    /// FK to tblBulkRunScheduleHeader.ScheduleId. One header groups
    /// N day rows (one per DayOfWeek + Speed + Region variant). Added
    /// 2026-09-08 by AddScheduleHeaderAndIdKeyedLinks; column renamed
    /// from BulkRunScheduleGroupId to ScheduleId on 2026-09-09 by
    /// RenameScheduleIdToClarifyKeySpace. Distinct from this entity's
    /// own BulkRunScheduleId PK above (day-row PK, legacy, unchanged).
    /// </summary>
    public int ScheduleId { get; set; }

    /// <summary>
    /// Nav prop to the schedule header. Left optional so EF isn't forced
    /// to eager-load - the service layer opts in via Include when it
    /// needs IsDefault / RetiredUtc / LegacyClientId.
    /// </summary>
    public virtual BulkRunScheduleHeader Header { get; set; }

    public string Name { get; set; }
    // smallint in the DB (not int) - typing this as `int?` triggers an
    // InvalidCastException when EF materialises the row.
    public short? DayOfWeek { get; set; }
    public int? ClientId { get; set; }
    public int? SpeedId { get; set; }
    // int in the DB (foreign key into a region table), not nvarchar.
    // Callers that read + coalesce it treat the value as an opaque discriminator.
    public int? Region { get; set; }
    // TIME on every tenant, so TimeSpan? is correct everywhere and no
    // per-tenant fork is needed. This comment used to say NZ was DATETIME
    // and that a fork or a Dapper CAST would be required; that was measured
    // and found false. Urgent Prod (6 Oct 2026) and Medical Prod (7 Oct)
    // both report TIME for StartTime, EndTime and CutoffTime, which is why
    // the compatibility view in 20261009177000 is a single body rather than
    // branching on sys.columns. Checked again on both local tenants after
    // that migration applied: time(7).
    public TimeSpan? StartTime { get; set; }
    public TimeSpan? EndTime { get; set; }
    public bool? AutoBook { get; set; }
    // Pickup-cutoff fields on the schedule (Plan §Phase 2 §6.5 Fixed pickup
    // windows). If ApplyPickupCutoff is true, the courier must arrive on the
    // pickup leg no later than `PickupCutoff` hours before delivery. Route
    // Builder surfaces these on the job DTO so the build split logic can cap
    // the run's total mins accordingly.
    public bool? ApplyPickupCutoff { get; set; }
    public int? PickupCutoff { get; set; }
    public bool? BookPickup { get; set; }

    /// <summary>Many-to-many with Route via the tblRouteSchedule junction
    /// (RouteId, ScheduleId). Reciprocal of Route.Schedules.</summary>
    public virtual ICollection<Route> Routes { get; set; } = new List<Route>();
}
