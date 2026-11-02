#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// One price: what a zone costs at a speed. The grid on the Pricing tab is
/// these rows pivoted, zones down and speeds across.
///
/// Today the row is identified by (DepotId, Zone, SpeedId, ClientId). The
/// spec's target is for it to hang off a zone group instead, and Phase 1A
/// added PostcodeGroupId for that, but the backfill left it NULL on all 5,323
/// rows on Urgent and SheetId likewise. So the read side resolves a group to
/// its depot and matches on that, preferring PostcodeGroupId wherever Phase 2
/// has filled it. Writing a new row stamps both, so the column fills in as
/// prices are edited rather than needing a second backfill.
///
/// Amount is the dollars column Phase 1A added; RateCodeId is the legacy
/// pointer into the rate-code table it replaces, kept because
/// fncT_BulkZoneRate_WithLinehaul still falls back to it for the 119 rows the
/// backfill could not resolve.
/// </summary>
public partial class BulkZoneRate
{
    public int Id { get; set; }
    public DateTime Created { get; set; }
    public int? RateCodeId { get; set; }
    public int Zone { get; set; }
    public int? SiteId { get; set; }
    public int? ClientId { get; set; }
    public int? SpeedId { get; set; }
    public int? DepotId { get; set; }

    /// <summary>Courier pay for this cell, as a percentage of the price.</summary>
    public decimal? CourierPercentage { get; set; }

    /// <summary>Rarely used third dimension; 197 of 5,323 rows carry one.</summary>
    public int? StockSizeId { get; set; }

    public bool ChargePerConsignment { get; set; }
    public int? PostcodeGroupId { get; set; }
    public decimal? Amount { get; set; }
    public string Label { get; set; }
    public bool Active { get; set; } = true;
    public int? SheetId { get; set; }
}
