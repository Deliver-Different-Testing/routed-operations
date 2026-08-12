// Partial extension for TblBulkScheduleLinehaul - adds the Name column + the
// BulkRunSchedule navigation property the Recurring Routes Linehaul port needs
// for the "Used by Schedules" drill-down (Fixes 7). Both columns pre-exist in
// the shared Despatch DB (verified 2026-08-12 via MCP).
//
// Base TblBulkScheduleLinehaul.cs already declares BulkRunScheduleId; this
// partial only supplies the nav + Name to avoid duplicating the FK column.
#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TblBulkScheduleLinehaul
{
    public string Name { get; set; }

    // Nav populated by convention off the existing BulkRunScheduleId FK.
    public virtual TblBulkRunSchedule BulkRunSchedule { get; set; }
}
