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
    public string Name { get; set; }
    public int? DayOfWeek { get; set; }
    public int? ClientId { get; set; }
    public int? SpeedId { get; set; }
    public string Region { get; set; }
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
}
