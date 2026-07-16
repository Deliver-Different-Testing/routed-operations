#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

public partial class TblBulkJobRun
{
    public int Id { get; set; }
    public int? RunId { get; set; }
    public int? BulkJobId { get; set; }
    public int? PickRunOrder { get; set; }

    public virtual TblBulkJob BulkJob { get; set; }
    public virtual TblBulkRun Run { get; set; }
}
