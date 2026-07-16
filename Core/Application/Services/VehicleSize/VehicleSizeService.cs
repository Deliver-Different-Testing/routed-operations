using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.VehicleSize;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.VehicleSize;

/// <summary>
/// Returns the vehicle presets that carry a cubic capacity. Populates the
/// Vehicle Capacity dropdown in the Build Runs config modal. Matches the
/// legacy inline SQL in JobRepository.GetVehicleSizesAsync.
/// </summary>
public class VehicleSizeService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    public async Task<List<VehicleSizeDto>> GetAllAsync()
    {
        return await Context.VehicleSizes
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
}
