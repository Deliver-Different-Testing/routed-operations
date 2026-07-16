// The Despatch DB's client table. RunBuilder only needs two columns from it:
// ucclID (primary key, joined from tblBulkJob.ClientID) and MaxJobsPerRun (the
// per-client cap the Max Boxes build mode uses to divide a bucket into runs).
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tucClient")]
public partial class TucClient
{
    [Column("ucclID")]
    public int UcclId { get; set; }

    [Column("MaxJobsPerRun")]
    public int? MaxJobsPerRun { get; set; }
}
