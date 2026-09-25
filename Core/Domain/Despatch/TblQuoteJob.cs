using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Shadow job uploaded for quoting purposes. Never promoted to tucJob or
/// tblBulkJob - lives entirely in the quoting sandbox so pricing scenarios
/// can be modelled without polluting the live operational pool.
/// Scoped by QuoteSetCode so multiple concurrent quotes coexist cleanly.
///
/// Stage 2 - C.3.
/// </summary>
[Table("tblQuoteJob")]
public class TblQuoteJob
{
    [Key]
    public int QuoteJobId { get; set; }

    [Required]
    [MaxLength(100)]
    public string QuoteSetCode { get; set; } = string.Empty;

    /// <summary>Set only after a simulation assigns this job to a quote run.</summary>
    public int? QuoteRunId { get; set; }

    [MaxLength(200)]
    public string? Customer { get; set; }

    [MaxLength(500)]
    public string? FromAddress { get; set; }

    [MaxLength(500)]
    public string? ToAddress { get; set; }

    public int? FromPostCode { get; set; }
    public int? ToPostCode { get; set; }
    public decimal? WeightKg { get; set; }
    public TimeOnly? WindowStart { get; set; }
    public TimeOnly? WindowEnd { get; set; }
    public bool IsPickup { get; set; }

    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;

    [ForeignKey(nameof(QuoteRunId))]
    public virtual TblQuoteRun? QuoteRun { get; set; }
}
