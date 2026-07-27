using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.VehicleSize;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.VehicleSize;

/// <summary>
/// Returns the vehicle presets that carry a cubic capacity. Populates the
/// Vehicle Capacity dropdown in the Build Runs config modal. Matches the
/// legacy inline SQL in JobRepository.GetVehicleSizesAsync.
/// </summary>
public class VehicleSizeService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    TenantScopedCache cache)
    : BaseService(contextFactory)
{
    // 1-hour sliding TTL. Vehicle sizes are edited via AdminManager; effectively
    // static reference data during any operator session.
    private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(1);

    public Task<List<VehicleSizeDto>> GetAllAsync() =>
        cache.GetOrSetAsync("vehicle-sizes:all", CacheTtl, LoadAllAsync);

    private async Task<List<VehicleSizeDto>> LoadAllAsync() =>
        await Context.VehicleSizes
            .AsNoTracking()
            .Where(v => v.CubicCapacity != null)
            .OrderBy(v => v.CubicCapacity)
            .ThenBy(v => v.VehicleName)
            .Select(v => new VehicleSizeDto
            {
                VehicleSizeId = v.VehicleSizeId,
                VehicleName = v.VehicleName ?? string.Empty,
                CubicCapacity = v.CubicCapacity,
            })
            .ToListAsync();
}
