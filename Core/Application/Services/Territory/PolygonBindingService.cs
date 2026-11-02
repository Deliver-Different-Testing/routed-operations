using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Territory;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Territory;

/// <summary>
/// US ZoneName to polygon binding. Reads and writes the single nullable
/// column tblBulkRunPolygon.ZoneNameId from migration
/// 20260824170000_AddZoneBindingToBulkRunPolygon.
///
/// The postcode-group axis is NOT here any more. A polygon is a MEMBER of a
/// zone inside a group, recorded in BulkZonePolygon and unique on
/// (PostcodeGroupId, PolygonId), so the same shape may be Zone 4 in
/// Auckland's group and Zone 2 in a client's group at the same time
/// (spec 3.1, migration 20261007170000). The sibling column
/// tblBulkRunPolygon.PostcodeGroupId can hold only one group and reading it
/// as ownership is what made Duplicate refuse to copy polygons; writes now go
/// through BulkPolygonService.AddToZoneAsync / RemoveFromZoneAsync, which also
/// enforce the one-zone-per-group overlap rule. The column itself is dropped
/// in a follow-up migration once this is live, app first because the change is
/// destructive.
/// </summary>
public class PolygonBindingService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    /// <summary>All (Active) polygons bound to a given ZoneName.</summary>
    public async Task<List<BoundPolygonDto>> GetForZoneNameAsync(int zoneNameId) =>
        await Context.BulkRunPolygons.AsNoTracking()
            .Where(p => p.Active && p.ZoneNameId == zoneNameId)
            .OrderBy(p => p.Name)
            .Select(p => new BoundPolygonDto(
                p.PolygonId, p.Name, p.ZoneNameId, p.PostcodeGroupId,
                p.CentroidLatitude, p.CentroidLongitude))
            .ToListAsync();

    /// <summary>Every shape that is a member of a zone inside this group,
    /// carrying the zone it joined and its membership id so the caller can
    /// show and remove it.</summary>
    public async Task<List<BoundPolygonDto>> GetForPostcodeGroupAsync(int postcodeGroupId) =>
        await (
                from zp in Context.BulkZonePolygons.AsNoTracking()
                join p in Context.BulkRunPolygons.AsNoTracking()
                    on zp.PolygonId equals p.PolygonId
                where zp.Active && p.Active && zp.PostcodeGroupId == postcodeGroupId
                orderby zp.Zone, p.Name
                select new BoundPolygonDto(
                    p.PolygonId, p.Name, p.ZoneNameId, zp.PostcodeGroupId,
                    p.CentroidLatitude, p.CentroidLongitude, zp.Zone, zp.Id))
            .ToListAsync();

    /// <summary>Bind (or clear) a polygon's US ZoneName. Pass null to clear.
    /// Group membership is not touched here; it lives in BulkZonePolygon and
    /// is written through BulkPolygonService.</summary>
    public async Task<BoundPolygonDto> BindZoneNameAsync(int polygonId, int? zoneNameId)
    {
        var entity = await Context.BulkRunPolygons
            .FirstOrDefaultAsync(p => p.PolygonId == polygonId)
            ?? throw new InvalidOperationException("Polygon not found.");
        entity.ZoneNameId = zoneNameId;
        entity.LastModifiedUtc = DateTime.UtcNow;
        await Context.SaveChangesAsync();
        return new BoundPolygonDto(
            entity.PolygonId, entity.Name, entity.ZoneNameId, entity.PostcodeGroupId,
            entity.CentroidLatitude, entity.CentroidLongitude);
    }
}
