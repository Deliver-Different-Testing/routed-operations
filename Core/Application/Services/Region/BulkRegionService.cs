using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Region;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Region;

/// <summary>
/// Read-side lift of `RVW_stpBulkRegions`. The legacy SP declared @RunDate but
/// never used it; we accept and ignore it too so the endpoint contract is
/// unchanged. Active regions only.
/// </summary>
public class BulkRegionService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    public async Task<List<RegionDto>> GetForRunDateAsync(DateTime _)
    {
        return await Context.TblBulkRegions
            .Where(r => r.Active == true)
            .OrderBy(r => r.Name)
            .Select(r => new RegionDto { Id = r.BulkRegionId, Label = r.Name })
            .ToListAsync();
    }
}
