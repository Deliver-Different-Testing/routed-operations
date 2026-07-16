using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Speed;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Speed;

/// <summary>
/// Read-side lift of `RVW_stpBulkSpeeds` (per-date) and the inline "all speeds"
/// query. Per-date variant only returns speeds that actually appear on
/// tblBulkJob for that BookDate; the all-speeds variant scans tucJobType.
/// </summary>
public class SpeedService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    public async Task<List<SpeedDto>> GetForRunDateAsync(DateTime runDate)
    {
        var query =
            from j in Context.TblBulkJobs
            join t in Context.TucJobTypes on j.Speed equals t.UcjtId
            where j.BookDate.Date == runDate.Date
            select new { j.Speed, t.UcjtName };

        var speeds = await query.Distinct().ToListAsync();

        return speeds
            .Select(x => new SpeedDto { Id = x.Speed, Label = x.UcjtName ?? string.Empty })
            .OrderBy(x => x.Label)
            .ToList();
    }

    public async Task<List<SpeedDto>> GetAllAsync()
    {
        return await Context.TucJobTypes
            .OrderBy(t => t.UcjtName)
            .Select(t => new SpeedDto { Id = t.UcjtId, Label = t.UcjtName ?? string.Empty })
            .ToListAsync();
    }
}
