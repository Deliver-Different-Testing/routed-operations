using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Speed;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Speed;

/// <summary>
/// Read-side lift of `RVW_stpBulkSpeeds` (per-date) and the inline "all speeds"
/// query. Per-date variant only returns speeds that actually appear on
/// tblBulkJob for that BookDate; the all-speeds variant scans tucJobType.
/// </summary>
public class SpeedService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    TenantScopedCache cache)
    : BaseService(contextFactory)
{
    // 5-min sliding for per-date speeds (bookings churn during the day but
    // the speed set for a given date is bounded and stable). 1h for the
    // all-speeds lookup (tucJobType is reference data managed elsewhere).
    private static readonly TimeSpan PerDateTtl = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan AllTtl = TimeSpan.FromHours(1);

    public Task<List<SpeedDto>> GetForRunDateAsync(DateTime runDate) =>
        cache.GetOrSetAsync($"speeds:date:{runDate:yyyyMMdd}", PerDateTtl,
            () => LoadForRunDateAsync(runDate));

    private async Task<List<SpeedDto>> LoadForRunDateAsync(DateTime runDate)
    {
        // AsNoTracking on both source sets - projection to SpeedDto, no
        // entities returned, no mutation possible downstream.
        var query =
            from j in Context.TblBulkJobs.AsNoTracking()
            join t in Context.TucJobTypes.AsNoTracking() on j.Speed equals t.UcjtId
            where j.BookDate.Date == runDate.Date
            select new { j.Speed, t.UcjtName };

        var speeds = await query.Distinct().ToListAsync();

        return speeds
            .Select(x => new SpeedDto { Id = x.Speed, Label = x.UcjtName ?? string.Empty })
            .OrderBy(x => x.Label)
            .ToList();
    }

    public Task<List<SpeedDto>> GetAllAsync() =>
        cache.GetOrSetAsync("speeds:all", AllTtl, LoadAllAsync);

    private async Task<List<SpeedDto>> LoadAllAsync() =>
        await Context.TucJobTypes
            .AsNoTracking()
            .OrderBy(t => t.UcjtName)
            .Select(t => new SpeedDto { Id = t.UcjtId, Label = t.UcjtName ?? string.Empty })
            .ToListAsync();
}
