#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

public partial class TblBulkJobRun
{
    public int Id { get; set; }
    public int? RunId { get; set; }
    public int? BulkJobId { get; set; }
    public int? PickRunOrder { get; set; }
    // Per-run-per-job start/end markers per legacy runBuilder.tpl:50-54.
    // IsStart -> play icon; IsEnd -> flag-checkered icon. Both persist so
    // the driver app / next Optimise honours the operator's manual pin.
    // Added by migration 20260717090000.
    public bool IsStart { get; set; }
    public bool IsEnd { get; set; }

    public virtual TblBulkJob BulkJob { get; set; }
    public virtual TblBulkRun Run { get; set; }
}
