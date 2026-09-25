#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// tblBulkScheduleLinehaul rows attach a linehaul run configuration to a
/// tblBulkRunSchedule. Route Builder only reads InsertToBulk to decide
/// whether LH-suffixed jobs on that schedule should be hidden from the
/// cockpit (legacy filter: NOT EXISTS (... AND InsertToBulk = 0 AND
/// JobNumber LIKE '%LH%')).
/// </summary>
[Table("tblBulkScheduleLinehaul")]
public partial class TblBulkScheduleLinehaul
{
    public int Id { get; set; }
    public int? BulkRunScheduleId { get; set; }
    public bool? InsertToBulk { get; set; }
    public bool? Active { get; set; }
}
