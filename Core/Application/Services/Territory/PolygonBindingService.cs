using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Territory;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Territory;

/// <summary>
/// Zone-to-polygon binding surface. Sits alongside the existing
/// BulkPolygonService (which owns polygon CRUD + geography derivation)
/// so that adding zone binding does not force a large edit of the
/// polygon service's write-path. Reads + writes only the two
/// nullable FK columns tblBulkRunPolygon.ZoneNameId +
/// PostcodeGroupId added in migration
/// 20260824170000_AddZoneBindingToBulkRunPolygon.
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

    /// <summary>All (Active) polygons bound to a given PostcodeGroup.</summary>
    public async Task<List<BoundPolygonDto>> GetForPostcodeGroupAsync(int postcodeGroupId) =>
        await Context.BulkRunPolygons.AsNoTracking()
            .Where(p => p.Active && p.PostcodeGroupId == postcodeGroupId)
            .OrderBy(p => p.Name)
            .Select(p => new BoundPolygonDto(
                p.PolygonId, p.Name, p.ZoneNameId, p.PostcodeGroupId,
                p.CentroidLatitude, p.CentroidLongitude))
            .ToListAsync();

    /// <summary>Bind (or re-bind) a polygon to a ZoneName and/or a
    /// PostcodeGroup. Pass null to a field to clear that binding. Passing
    /// null to both clears every binding on the polygon (its content is
    /// unaffected).</summary>
    public async Task<BoundPolygonDto> BindAsync(int polygonId, int? zoneNameId, int? postcodeGroupId)
    {
        var entity = await Context.BulkRunPolygons
            .FirstOrDefaultAsync(p => p.PolygonId == polygonId)
            ?? throw new InvalidOperationException("Polygon not found.");
        entity.ZoneNameId = zoneNameId;
        entity.PostcodeGroupId = postcodeGroupId;
        entity.LastModifiedUtc = DateTime.UtcNow;
        await Context.SaveChangesAsync();
        return new BoundPolygonDto(
            entity.PolygonId, entity.Name, entity.ZoneNameId, entity.PostcodeGroupId,
            entity.CentroidLatitude, entity.CentroidLongitude);
    }
}
