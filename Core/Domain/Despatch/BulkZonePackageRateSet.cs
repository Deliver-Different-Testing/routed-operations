#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>A named dimension rule set (spec 11.2), so the same bands can be
/// shared rather than retyped per client.</summary>
public partial class BulkZonePackageRateSet
{
    public int Id { get; set; }
    public string Name { get; set; }
    public bool IsDefault { get; set; }
    public bool Active { get; set; } = true;
}
