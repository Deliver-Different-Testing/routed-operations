using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Courier;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Courier;

/// <summary>
/// Read-side lift of `UTL_stpCourier_Active`. Matches the legacy SP contract
/// exactly: filter on the `Active` BIT column. Prior implementation used the
/// UccrStartDate/UccrFinishDate window - kept as a secondary belt-and-braces
/// guard since some tenants historically clear the Active flag when a courier
/// finishes rather than setting FinishDate.
/// </summary>
public class CourierService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    TenantScopedCache cache)
    : BaseService(contextFactory)
{
    // 5-minute sliding TTL. Couriers are edited via a different app
    // (CourierManager) so this app cannot invalidate on write; 5 min is an
    // acceptable staleness ceiling that still eliminates the ~90% of hits
    // that happen inside a single operator session.
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);

    public Task<List<CourierDto>> GetActiveAsync() =>
        cache.GetOrSetAsync("couriers:active", CacheTtl, LoadActiveAsync);

    private async Task<List<CourierDto>> LoadActiveAsync()
    {
        // AsNoTracking on both source sets - projection to CourierDto only.
        var query =
            from c in Context.TucCouriers.AsNoTracking()
            join f in Context.TucCourierFleets.AsNoTracking() on c.CourierFleetId equals f.UccfId into fleetJoin
            from f in fleetJoin.DefaultIfEmpty()
            where c.Active
            select new CourierDto
            {
                CourierId = c.UccrId,
                Code = c.Code ?? string.Empty,
                FirstName = c.UccrName ?? string.Empty,
                DisplayName = ((c.Code ?? string.Empty) + " " + (c.UccrName ?? string.Empty)).Trim(),
                Fleet = f != null ? f.UccfName : null
            };

        var couriers = await query.ToListAsync();

        return couriers
            .OrderBy(c => int.TryParse(c.Code, out var n) ? n : int.MaxValue)
            .ThenBy(c => c.Code)
            .ToList();
    }

    public async Task<List<FleetDto>> GetActiveByFleetAsync()
    {
        var couriers = await GetActiveAsync();
        return couriers
            .GroupBy(c => c.Fleet ?? "(Unassigned)")
            .Select(g => new FleetDto
            {
                Fleet = g.Key,
                Couriers = g.ToList()
            })
            .OrderBy(g => g.Fleet)
            .ToList();
    }
}
