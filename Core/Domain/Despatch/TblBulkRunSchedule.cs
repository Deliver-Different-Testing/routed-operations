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
    // On US this column is TIME (TimeSpan in .NET); on NZ it's DATETIME.
    // We declare it as TimeSpan? here because that's what the US tenant needs
    // - the legacy SP resolved the cross-tenant difference with CAST(x AS
    // datetime) which happens on the DB side. In EF LINQ we have to pick one
    // CLR type; TimeSpan? works for US (Route Builder's initial target). NZ
    // rollout will need a follow-up: either a per-tenant entity fork, or
    // (cleaner) switch this specific query to Dapper with the same CAST.
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
