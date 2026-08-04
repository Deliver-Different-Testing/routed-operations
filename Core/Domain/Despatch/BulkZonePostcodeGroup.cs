#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>Optional grouping over `BulkZonePostcode` rows within a depot
/// (NZ rating geography). Populated via ClientManager; RoutedOperations
/// reads it for the Polygon Builder "VIEW Zones" drawer.</summary>
public partial class BulkZonePostcodeGroup
{
    public int Id { get; set; }
    public string Name { get; set; }
    public int? ClientId { get; set; }
    public int? DepotId { get; set; }

    public virtual TblBulkRegion Depot { get; set; }
    public virtual ICollection<BulkZonePostcode> BulkZonePostcodes { get; set; } = new List<BulkZonePostcode>();
}
