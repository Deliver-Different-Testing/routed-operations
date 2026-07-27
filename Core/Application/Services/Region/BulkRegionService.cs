using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Region;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Region;

/// <summary>
/// Read-side lift of `RVW_stpBulkRegions`. The legacy SP declared @RunDate but
/// never used it; we accept and ignore it too so the endpoint contract is
/// unchanged. Active regions only.
/// </summary>
public class BulkRegionService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    TenantScopedCache cache)
    : BaseService(contextFactory)
{
    // 1-hour sliding TTL. Regions are reference data edited via a different
    // app (AdminManager); staleness ceiling of 1h is acceptable.
    private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(1);

    public Task<List<RegionDto>> GetForRunDateAsync(DateTime _) =>
        cache.GetOrSetAsync("regions:active", CacheTtl, LoadActiveAsync);

    private async Task<List<RegionDto>> LoadActiveAsync() =>
        await Context.TblBulkRegions
            .AsNoTracking()
            .Where(r => r.Active == true)
            .OrderBy(r => r.Name)
            .Select(r => new RegionDto { Id = r.BulkRegionId, Label = r.Name })
            .ToListAsync();
}
