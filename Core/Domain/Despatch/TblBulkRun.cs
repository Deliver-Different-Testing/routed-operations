#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

public partial class TblBulkRun
{
    public int Id { get; set; }
    public string Name { get; set; }
    public int? Mins { get; set; }
    public double? Kms { get; set; }
    public int? CourierId { get; set; }
    public int? Status { get; set; }
    public decimal? Revenue { get; set; }
    public decimal? Payout { get; set; }
    public double? CourierPercentage { get; set; }
    public string GoogleRouteResponse { get; set; }
    public DateTime? Created { get; set; }
    public DateTime? LastModified { get; set; }
    public DateTime? DespatchDateTime { get; set; }
    // Route Builder routing-mode fields (per 20260716210000 migration).
    // NoReroute defaults to false; RoutingMode defaults to 0 (A-B); the schema
    // adds NOT NULL DEFAULTs so untouched legacy writes stay valid.
    // 0 = A-B (depot -> furthest); 1 = A-A (depot -> ... -> depot); 2 = FinishAtStop.
    public bool NoReroute { get; set; }
    public byte RoutingMode { get; set; }
    public int? FinishAtBulkJobId { get; set; }
    // Marks the special "Void Jobs" run per legacy homeControl.js:1224-1285.
    // Voided jobs land here; it's always displayed as locked and shows a ban
    // icon prefix in the Runs list. Added by migration 20260717090000.
    public bool IsVoidRun { get; set; }

    public virtual ICollection<TblBulkJobRun> TblBulkJobRuns { get; set; } = new List<TblBulkJobRun>();
}
