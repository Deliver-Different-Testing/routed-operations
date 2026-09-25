// Audit table row for one Historic Archive Upload. Backs
// dbo.HistoricArchiveImportBatch created by
// 20260819100000_HistoricArchiveImportBatch.sql. Every batch stamps its
// contiguous ucjbID range on ImportedIdStart / ImportedIdEnd so any
// tucJobArchive row (SourceID = 900) can be traced back to its owning
// batch by a range lookup.
#nullable disable

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("HistoricArchiveImportBatch")]
public class HistoricArchiveImportBatch
{
    [Key]
    public int Id { get; set; }

    public int UploadedByContact { get; set; }

    public DateTime UploadedAt { get; set; }

    [Required]
    [MaxLength(260)]
    public string FileName { get; set; }

    [Required]
    [MaxLength(50)]
    public string TenantCode { get; set; }

    public int RowCount { get; set; }

    public int InsertedCount { get; set; }

    public int RejectedCount { get; set; }

    public string Notes { get; set; }

    public int? ImportedIdStart { get; set; }

    public int? ImportedIdEnd { get; set; }

    /// <summary>Serialised JSON payload of per-row rejection reasons
    /// captured at commit time. Shape:
    ///   [ { "rowIndex": 1, "jobNumber": "JRK1000", "message": "..." }, ... ]
    /// Null when the batch succeeded with zero rejections. Populated by
    /// HistoricArchiveService.CommitAsync so the drill-down UI can
    /// render the reasons after the wizard is dismissed.</summary>
    public string Errors { get; set; }
}
