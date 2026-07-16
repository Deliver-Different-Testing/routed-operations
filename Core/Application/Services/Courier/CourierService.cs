using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Courier;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Courier;

/// <summary>
/// Read-side lift of `UTL_stpCourier_Active`. Active = start date reached and
/// no finish date recorded. Returns each courier joined to its fleet name for
/// the cockpit's fleet grouping.
/// </summary>
public class CourierService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    public async Task<List<CourierDto>> GetActiveAsync()
    {
        var now = DateTime.Now;
        var query =
            from c in Context.TucCouriers
            join f in Context.TucCourierFleets on c.CourierFleetId equals f.UccfId into fleetJoin
            from f in fleetJoin.DefaultIfEmpty()
            where c.UccrFinishDate == null
                  && (c.UccrStartDate == null || c.UccrStartDate <= now)
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
