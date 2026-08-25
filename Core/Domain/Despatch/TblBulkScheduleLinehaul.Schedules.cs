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
}
