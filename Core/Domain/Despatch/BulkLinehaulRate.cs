#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// What one linehaul run costs. Created by dbmigrationsv2 migration
/// 20261030152000_BulkLinehaulRate and seeded from the existing leg figures.
///
/// The key is (LinehaulRunId, ScheduleId, SpeedId, ClientId) with NULL meaning
/// "any" on the last three, so resolution is most specific first: the
/// schedule's own price, then the run's price for that speed, then the run's
/// price for any speed; and a client row beats the default at every level.
///
/// ScheduleId is in the key because the measurement said so: on Urgent
/// production the schedule explains 1,985 of 2,005 contested (run, client,
/// speed) triples, so a run-only price would have had to pick one of several
/// real prices for the same run. The seed wrote 1,401 rows, every one of them
/// per (run, schedule), which is why the Linehaul tab cannot be the flat
/// run-by-speed grid the 15 Oct mock drew.
///
/// Amount and AmountPercentage are mutually exclusive, enforced by
/// CK_BulkLinehaulRate_OneOf on the table.
/// </summary>
public partial class BulkLinehaulRate
{
    public int Id { get; set; }
    public int LinehaulRunId { get; set; }

    /// <summary>NULL = this price applies to the run whatever schedule books it.</summary>
    public int? ScheduleId { get; set; }

    /// <summary>NULL = any speed.</summary>
    public int? SpeedId { get; set; }

    /// <summary>NULL = the default, i.e. every client without a row of its own.</summary>
    public int? ClientId { get; set; }

    public decimal? Amount { get; set; }
    public decimal? AmountPercentage { get; set; }
    public bool Active { get; set; } = true;

    public virtual TblbulkLinehaulRun LinehaulRun { get; set; }
}
