#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Zone-binding columns on tblBulkRunPolygon, added by migration
/// 20260824170000_AddZoneBindingToBulkRunPolygon. Both nullable - a
/// polygon may bind to neither, one, or (unusual but not blocked)
/// both. Consumed by the Schedules module's Zone Groups tab so the
/// operator can attach a coverage polygon to a US ZoneName or an
/// NZ/US PostcodeGroup without needing a new polygon table.
///
/// These columns will be missing on tenants that have not yet applied
/// the migration; EF will fail the SELECT until the migration is
/// applied there. Ship the migration first before deploying this code
/// to a new tenant.
/// </summary>
public partial class BulkRunPolygon
{
    public int? ZoneNameId { get; set; }
    public int? PostcodeGroupId { get; set; }
}
