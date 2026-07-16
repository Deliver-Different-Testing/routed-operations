#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Postcode -> Run-name / Merge-to / Sequence lookup used by the Build Runs
/// Max Boxes mode. Legacy SP joins this via `rn.PostCode = tblBulkJob.ToPostCode`
/// and returns `PrefixRunName` (fallback to raw postcode), `PostCodeMergeTo`
/// (merge two adjacent postcodes into the same run) and `RunSequence`.
/// </summary>
[Table("TblBulkPostCodeRunName")]
public partial class TblBulkPostCodeRunName
{
    public int Id { get; set; }
    public string PostCode { get; set; }
    public string RunName { get; set; }
    public string PostCodeMergeTo { get; set; }
    public int? RunSequence { get; set; }
}
