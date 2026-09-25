// EF entity for dbo.CourierSchedule. One row per (Location, BookDate,
// Name) - the operator-defined shift window (StartTime -> EndTime) for
// couriers to opt into. Wanted = target headcount for that shift.
// NotificationSent = the moment couriers were SMS'd; setting it locks
// the schedule from deletion (per the legacy delete-blocked-when-notified
// guard).
//
// Column shape verified via mssql MCP 2026-09-07: exactly 10 columns.
// LocationId nav -> TblBulkRegion (already in DespatchContext).
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("CourierSchedule")]
public class CourierSchedule
{
    public long Id { get; set; }

    public DateTime Created { get; set; }

    public DateTime BookDate { get; set; }

    public int? SiteId { get; set; }

    public string Name { get; set; }

    public DateTime? NotificationSent { get; set; }

    public TimeOnly StartTime { get; set; }

    public TimeOnly EndTime { get; set; }

    public int Wanted { get; set; }

    public int? LocationId { get; set; }

    // Nav to the depot. Legacy binds this via FK -> TblBulkRegion.BulkRegionId.
    // Explicit ForeignKey attribute so EF doesn't shadow-generate a second
    // FK column.
    [ForeignKey(nameof(LocationId))]
    public virtual TblBulkRegion Location { get; set; }

    // Back-nav to the courier responses attached to this schedule. Read-only
    // - we never assign this collection directly, we AddRange to the DbSet.
    public virtual ICollection<CourierScheduleResponse> CourierScheduleResponses { get; set; }
        = new List<CourierScheduleResponse>();
}
