using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Simulated run produced by the quoting engine over TblQuoteJob rows.
/// One row per (QuoteSetCode, run-index) - operators can compare cost /
/// revenue / margin per run before committing to a quote.
/// </summary>
[Table("tblQuoteRun")]
public class TblQuoteRun
{
    [Key]
    public int QuoteRunId { get; set; }

    [Required]
    [MaxLength(100)]
    public string QuoteSetCode { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? Name { get; set; }

    public int JobCount { get; set; }
    public int EstimatedMins { get; set; }
    public double EstimatedKm { get; set; }
    public decimal ProjectedRevenue { get; set; }
    public decimal ProjectedCost { get; set; }
    public decimal RecommendedQuote { get; set; }
    public int DriversRequired { get; set; }

    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;

    public virtual ICollection<TblQuoteJob> QuoteJobs { get; set; }
        = new List<TblQuoteJob>();
}
