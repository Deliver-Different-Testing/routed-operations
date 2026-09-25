#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Extra fields on tblBulkScheduleLinehaul that the Schedules module
/// needs. Base + RecurringLinehaul + Entities.BulkImport partials
/// already declare everything else (Name, Amount, AmountPercentage,
/// FromDepotId, ToDepotId, LinehaulRunId, DropOffLocationId,
/// DepartureAdvanceDays, WeekDay, ApplyDiscount, FromClientAddress).
/// </summary>
public partial class TblBulkScheduleLinehaul
{
    public int? Minutes { get; set; }
    public bool? ApplyAddOnPercentage { get; set; }
    /// <summary>
    /// Per-leg-in-schedule service class override. Added 2026-06-19
    /// (migration 20260619040000_LinehaulScheduleLegSpeedId.sql) for
    /// multi-speed runs where legs on the same truck declare different
    /// service classes. Nullable = inherit from run / schedule.
    /// </summary>
    public int? SpeedId { get; set; }
}
