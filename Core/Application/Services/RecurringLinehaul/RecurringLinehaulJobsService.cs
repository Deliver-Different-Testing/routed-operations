using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RecurringLinehaul;

/// <summary>
/// Read-side helpers for the Mapped Stops drill-down (Recurring Routes spec 5).
/// Serves the per-run job list + per-job detail + speed patch. Speed grouping
/// is denormalised in via TucJobType join so the frontend SpeedChip colour rule
/// works without a separate lookup call.
/// </summary>
public class RecurringLinehaulJobsService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    public async Task<List<BulkJobListItemDto>> ListForLinehaulRunAsync(int runId)
    {
        var q =
            from j in Context.TblBulkJobs.AsNoTracking()
            where j.LinehaulRunId == runId && !j.Void
            join t in Context.TucJobTypes.AsNoTracking() on j.Speed equals t.UcjtId into ts
            from t in ts.DefaultIfEmpty()
            join g in Context.TucJobTypeGroupings.AsNoTracking() on t.GroupingId equals g.GroupingId into gs
            from g in gs.DefaultIfEmpty()
            join s in Context.Set<Domain.Despatch.TucJobStatus>().AsNoTracking() on j.JobStatus equals s.UcjsId into ss
            from s in ss.DefaultIfEmpty()
            orderby j.BookDate descending, j.BookTime descending
            select new BulkJobListItemDto
            {
                Id = j.BulkJobId,
                JobNumber = j.JobNumber ?? string.Empty,
                Pickup = j.FromAddress,
                Drop = j.ToAddress,
                SpeedId = j.Speed,
                SpeedShortName = t == null ? string.Empty : (t.ShortName ?? string.Empty),
                SpeedName = t == null ? string.Empty : (t.UcjtName ?? string.Empty),
                SpeedGroupingId = t == null ? null : (int?)t.GroupingId,
                SpeedGroupingName = g == null ? null : g.GroupingName,
                BookDate = j.BookDate.ToString("yyyy-MM-dd"),
                BookTime = j.BookTime.ToString("HH:mm"),
                StatusName = s == null ? null : s.UcjsName
            };
        return await q.ToListAsync();
    }

    public async Task<BulkJobDetailDto?> GetDetailAsync(int jobId)
    {
        var q =
            from j in Context.TblBulkJobs.AsNoTracking()
            where j.BulkJobId == jobId
            join t in Context.TucJobTypes.AsNoTracking() on j.Speed equals t.UcjtId into ts
            from t in ts.DefaultIfEmpty()
            join g in Context.TucJobTypeGroupings.AsNoTracking() on t.GroupingId equals g.GroupingId into gs
            from g in gs.DefaultIfEmpty()
            join s in Context.Set<Domain.Despatch.TucJobStatus>().AsNoTracking() on j.JobStatus equals s.UcjsId into ss
            from s in ss.DefaultIfEmpty()
            join lh in Context.TblbulkLinehaulRuns.AsNoTracking() on j.LinehaulRunId equals lh.Id into lhs
            from lh in lhs.DefaultIfEmpty()
            join c in Context.TucClients.AsNoTracking() on j.ClientId equals c.UcclId into cs
            from c in cs.DefaultIfEmpty()
            select new BulkJobDetailDto
            {
                Id = j.BulkJobId,
                JobNumber = j.JobNumber ?? string.Empty,
                Customer = c == null ? string.Empty : (c.UcclName ?? string.Empty),
                StatusName = s == null ? string.Empty : (s.UcjsName ?? string.Empty),
                // Concatenate client-side (see mapping below via AsEnumerable).
                PickupAddress = (j.FromCompany ?? string.Empty) + "|" + (j.FromAddress ?? string.Empty),
                DropAddress = (j.ToCompany ?? string.Empty) + "|" + (j.ToAddress ?? string.Empty),
                BookDate = j.BookDate.ToString("yyyy-MM-dd"),
                BookTime = j.BookTime.ToString("HH:mm"),
                LinehaulRunName = lh == null ? null : lh.RunName,
                SpeedId = j.Speed,
                SpeedShortName = t == null ? string.Empty : (t.ShortName ?? string.Empty),
                SpeedName = t == null ? string.Empty : (t.UcjtName ?? string.Empty),
                SpeedGroupingId = t == null ? null : (int?)t.GroupingId,
                SpeedGroupingName = g == null ? null : g.GroupingName,
                // Editable when the job hasn't been picked up yet. Legacy rule:
                // status 0/1/2 = Booked/Assigned/Accepted are still editable.
                SpeedEditable = j.JobStatus <= 2,
                Notes = j.Notes
            };
        var dto = await q.FirstOrDefaultAsync();
        if (dto is not null)
        {
            // Reshape the "company|address" placeholder into "company, address" on
            // the client so EF doesn't have to translate string.Join.
            dto.PickupAddress = JoinAddress(dto.PickupAddress);
            dto.DropAddress = JoinAddress(dto.DropAddress);
        }
        return dto;
    }

    private static string JoinAddress(string joined)
    {
        var parts = joined.Split('|', 2);
        var head = parts.Length > 0 ? parts[0].Trim() : string.Empty;
        var tail = parts.Length > 1 ? parts[1].Trim() : string.Empty;
        if (head.Length == 0 && tail.Length == 0) return string.Empty;
        if (head.Length == 0) return tail;
        if (tail.Length == 0) return head;
        return head + ", " + tail;
    }

    public async Task<BulkJobDetailDto?> UpdateSpeedAsync(int jobId, int speedId)
    {
        var job = await Context.TblBulkJobs.FirstOrDefaultAsync(j => j.BulkJobId == jobId);
        if (job is null) return null;
        job.Speed = speedId;
        await Context.SaveChangesAsync();
        return await GetDetailAsync(jobId);
    }

    public async Task<List<ReportingSpeedDto>> GetGroupedSpeedsAsync()
    {
        var q =
            from t in Context.TucJobTypes.AsNoTracking()
            join g in Context.TucJobTypeGroupings.AsNoTracking() on t.GroupingId equals g.GroupingId into gs
            from g in gs.DefaultIfEmpty()
            orderby g.GroupingName, t.UcjtName
            select new ReportingSpeedDto
            {
                Id = t.UcjtId,
                ShortName = t.ShortName ?? string.Empty,
                Name = t.UcjtName ?? string.Empty,
                GroupingId = t.GroupingId,
                GroupingName = g == null ? null : g.GroupingName
            };
        return await q.ToListAsync();
    }
}
