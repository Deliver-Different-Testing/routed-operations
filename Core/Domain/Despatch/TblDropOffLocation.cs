#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// tblDropOffLocation. One row per operator-owned drop point per depot
/// (e.g. "Auckland Airport Hub", "Wellington Depot Dock 3"). Schedules
/// point at these via DropOffLocationId + collection legs point at
/// per-leg drop-offs via TblBulkScheduleLinehaul.DropOffLocationId.
/// Read-only in RoutedOperations for the Schedules module - the CRUD
/// surface still lives in the legacy ClientManager.
/// </summary>
[Table("tblDropOffLocation")]
public partial class TblDropOffLocation
{
    public int DropOffLocationId { get; set; }
    public int DepotId { get; set; }
    public string Name { get; set; }
    public string Qrcode { get; set; }
}
