#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// A dimension band: cubic and weight from/to, and the rate per cubic unit.
/// Belongs to a rule set (SetId, spec 11.2) or, on the older rows, directly to
/// a client.
///
/// The inheritance rule here is NOT the one the zone grid uses: a client with
/// any rows of its own uses only its own rows, with no merge against the
/// default. That is how the legacy screen behaves and the Pricing tab says so
/// on screen rather than quietly changing it.
/// </summary>
public partial class BulkZonePackageRate
{
    public int Id { get; set; }
    public DateTime Created { get; set; }
    public decimal CubicRate { get; set; }
    public decimal? FromCubic { get; set; }
    public decimal? ToCubic { get; set; }
    public int? ClientId { get; set; }
    public string Name { get; set; }
    public decimal? FromWeight { get; set; }
    public decimal? ToWeight { get; set; }
    public int? SetId { get; set; }
}
