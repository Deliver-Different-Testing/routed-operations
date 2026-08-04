#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>Depot / location record. NZ operators call these "depots"; US
/// operators call the same concept "locations". Referenced by Route (via
/// DefaultCourierId's fleet), BulkZonePostcode (NZ rating geography), and
/// ZoneName (US rating geography).</summary>
public partial class TblBulkRegion
{
    public int BulkRegionId { get; set; }
    public string Name { get; set; }
    public bool? Active { get; set; }

    // Navs used by the ViewZones (`ZoneLookupService`) endpoint. Both sides
    // populated by convention via Fluent config in DespatchContext.
    public virtual ICollection<BulkZonePostcode> BulkZonePostcodes { get; set; } = new List<BulkZonePostcode>();
    public virtual ICollection<BulkZonePostcodeGroup> BulkZonePostcodeGroups { get; set; } = new List<BulkZonePostcodeGroup>();
    public virtual ICollection<ZoneName> ZoneNames { get; set; } = new List<ZoneName>();
}
