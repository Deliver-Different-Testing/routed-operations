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

    /// <summary>
    /// Travel order of this leg within its schedule, 1-based. Added
    /// 2026-09-28 (migration 20260928180000_AddLegOrderToScheduleLinehaul.sql)
    /// for Bug 1 of Steve's "Linehaul Leg Fixes" handover: the booking SPs
    /// used to number and time legs in clustered (Id) order, which is
    /// definition-insert order and not travel order, so hops were dispatched
    /// before the freight reached them.
    ///
    /// DD_/WS_stpBulkScheduleJob_InsertChildJobs now drive their linehaul
    /// cursor off "ORDER BY ISNULL(LegOrder, 2147483647), Id". NULL therefore
    /// means "not ordered, fall back to Id order" - i.e. exactly the old
    /// behaviour - which is what makes the column safe to add and safe to
    /// leave unset on an ambiguous chain.
    ///
    /// The Schedules NEW chain editor persists the leg's position in the
    /// chain here, so a saved schedule keeps its order. Without that the
    /// upsert path (which deletes and re-inserts every leg) would wipe the
    /// backfilled values and the schedule would silently regress.
    /// </summary>
    public int? LegOrder { get; set; }
}
