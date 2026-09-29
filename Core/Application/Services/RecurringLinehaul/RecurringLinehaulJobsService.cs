using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RecurringLinehaul;

/// <summary>
/// Read-side helpers for the Mapped Stops drill-down (Recurring Routes spec 5).
/// Serves the per-run job list + per-job detail + speed patch. Speed grouping
/// is denormalised in via TucJobType join so the frontend SpeedChip colour rule
/// works without a separate lookup call.
///
/// Bug 3 (Steve's 2026-09-25 linehaul spec): a linehaul leg's child job lands in
/// ONE of two tables, so every read here unions both and every id-addressed
/// call carries a <see cref="JobSources"/> discriminator.
///
///     WS_/DD_stpBulkScheduleJob_InsertChildJobs:
///         IF @InsertToBulk = 1  -> INSERT INTO tblBulkJob  (LinehaulRunID)
///         ELSE                  -> INSERT INTO tucJob      (LinehaulRunId)
///
/// This used to read tblBulkJob only, which is why the list came back empty on
/// a tenant whose legs are InsertToBulk = 0. Measured 2026-09-30:
///
///     tenant         tblBulkJob   tucJob
///     urgent-prod        35,228      738
///     medical-prod            0    5,246
///
/// Steve's spec said to switch the source to tucJob. That would have emptied
/// urgent-prod, which still has 29 distinct runs in tblBulkJob. 19 runs there
/// have stops in BOTH tables, so neither alone is complete for them and a union
/// is the only correct read.
///
/// dbo.tucJobArchive is NOT read: sp_JobArchive only moves void or finished
/// jobs, so it holds completed work this page has no use for. See
/// <see cref="JobSources"/> for the archive selection predicate.
/// </summary>
public class RecurringLinehaulJobsService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    /// <summary>Intermediate row so the three sources can be sorted together on
    /// real date/time values before they are formatted for the wire. Formatting
    /// first and sorting on the strings would still work for BookDate
    /// ("yyyy-MM-dd" sorts lexicographically) but not for a null BookTime.</summary>
    private sealed class StopRow
    {
        public int Id { get; set; }
        public string Source { get; set; } = string.Empty;
        public string JobNumber { get; set; } = string.Empty;
        public string? Pickup { get; set; }
        public string? Drop { get; set; }
        public int SpeedId { get; set; }
        public string SpeedShortName { get; set; } = string.Empty;
        public string SpeedName { get; set; } = string.Empty;
        public int? SpeedGroupingId { get; set; }
        public string? SpeedGroupingName { get; set; }
        public DateTime? BookDate { get; set; }
        public DateTime? BookTime { get; set; }
        public string? StatusName { get; set; }
    }

    /// <summary>Largest page the caller may ask for. The drill-down renders every
    /// returned row straight into the DOM, which is the reason this list is paged
    /// at all.</summary>
    private const int MaxPageSize = 200;

    private const int DefaultPageSize = 50;

    /// <summary>Lists one page of a run's stops, newest first.
    ///
    /// <paramref name="search"/> filters on job number and is applied on the
    /// SERVER, before the paging. It has to be: the drill-down's search box used
    /// to filter the whole list in the browser, which only worked because the
    /// whole list was loaded. With paging it would otherwise search 50 of 9,274
    /// rows and look broken.</summary>
    public async Task<BulkJobPageDto> ListForLinehaulRunAsync(
        int runId, int page = 1, int pageSize = DefaultPageSize, string? search = null)
    {
        var size = Math.Clamp(pageSize <= 0 ? DefaultPageSize : pageSize, 1, MaxPageSize);
        var pageNo = Math.Max(1, page);

        var all = BuildStops(runId);

        var term = search?.Trim();
        if (!string.IsNullOrEmpty(term))
        {
            all = all.Where(r => r.JobNumber.Contains(term));
        }

        // COUNT over the same UNION ALL, without the ORDER BY.
        var total = await all.CountAsync();

        var rows = await Order(all)
            .Skip((pageNo - 1) * size)
            .Take(size)
            .ToListAsync();

        var entries = rows.Select(Project).ToList();
        return new BulkJobPageDto(total, pageNo, size, entries);
    }

    /// <summary>The three sources as one composable query. Concat rather than
    /// three separate ToListAsync calls so EF emits a single UNION ALL: the sort
    /// and the OFFSET/FETCH then run on the server and only one page crosses the
    /// wire. Paging in memory would still have pulled every row for the run,
    /// which on urgent-prod 2026-09-30 is 9,274 rows for the largest.
    ///
    /// StopRow uses SETTABLE PROPERTIES and a member-initialiser projection on
    /// purpose. It started out as a positional record, and EF refused the whole
    /// thing with "Unable to translate set operation after client projection has
    /// been applied" - a constructor call counts as a client projection, and
    /// Concat after one cannot be translated. Do not turn it back into a record
    /// with constructor parameters.
    ///
    /// Verified 2026-09-30 by compiling this query against the SQL Server
    /// provider and reading ToQueryString(). One statement, shape:
    ///
    ///     SELECT [u].[Id], [u].[Source], ...
    ///     FROM (
    ///         SELECT ... FROM [tblBulkJob] AS [t]  ... WHERE [t].[LinehaulRunId]  = @runId AND [t].[Void]      = 0
    ///         UNION ALL
    ///         SELECT ... FROM [tucJob]     AS [t3] ... WHERE [t3].[LinehaulRunId] = @runId AND [t3].[ucjbVoid] = 0
    ///     ) AS [u]
    ///     ORDER BY [u].[BookDate] DESC, [u].[BookTime] DESC, [u].[Source], [u].[Id]
    ///     OFFSET @p ROWS FETCH NEXT @p4 ROWS ONLY
    ///
    /// If a future edit inserts a ToList / AsEnumerable anywhere in this chain the
    /// paging silently moves back into memory and nothing fails, so check the
    /// generated SQL rather than the tests when touching it.
    ///
    /// Filter columns: dbo.tucJob.LinehaulRunId is indexed on all four tenants;
    /// dbo.tblBulkJob.LinehaulRunID is indexed by migration
    /// 20260930100000_IndexTblBulkJobLinehaulRunId.
    ///
    /// A pushed leg can carry the run id on BOTH tables, so the tuc branch has to
    /// exclude its own bulk counterpart or the stop appears twice. When a bulk job
    /// is pushed live, tblBulkJob.JobID is back-filled with the new tucJob.ucjbID;
    /// if that tucJob row also carries LinehaulRunId, the same shipment satisfies
    /// both branches. Measured on urgent-prod 2026-09-30: 171 such pairs, all with
    /// identical run ids and all non-void. It is not rare in relative terms either -
    /// on runs 62, 63 and 64 (the CDL runs) EVERY tucJob row is a duplicate of a
    /// bulk row, so an un-deduplicated union showed all of those stops twice.
    ///
    /// The bulk row wins because it is the one this page has always shown and the
    /// id the UI has always addressed. tucJob.ParentID is a different and harmless
    /// relationship: 236 tuc LH rows join a bulk parent that way, but zero of those
    /// parents carry a run id, so that path cannot double count.</summary>
    private IQueryable<StopRow> BuildStops(int runId)
    {
        var bulk =
            from j in Context.TblBulkJobs.AsNoTracking()
            where j.LinehaulRunId == runId && !j.Void
            join t in Context.TucJobTypes.AsNoTracking() on j.Speed equals t.UcjtId into ts
            from t in ts.DefaultIfEmpty()
            join g in Context.TucJobTypeGroupings.AsNoTracking() on t.GroupingId equals g.GroupingId into gs
            from g in gs.DefaultIfEmpty()
            join s in Context.Set<Domain.Despatch.TucJobStatus>().AsNoTracking() on j.JobStatus equals s.UcjsId into ss
            from s in ss.DefaultIfEmpty()
            select new StopRow
                {
                    Id = j.BulkJobId,
                    Source = JobSources.Bulk,
                    JobNumber = j.JobNumber ?? string.Empty,
                    Pickup = j.FromAddress,
                    Drop = j.ToAddress,
                    SpeedId = j.Speed,
                    SpeedShortName = t == null ? string.Empty : (t.ShortName ?? string.Empty),
                    SpeedName = t == null ? string.Empty : (t.UcjtName ?? string.Empty),
                    SpeedGroupingId = t == null ? null : (int?)t.GroupingId,
                    SpeedGroupingName = g == null ? null : g.GroupingName,
                    BookDate = j.BookDate,
                    BookTime = j.BookTime,
                    StatusName = s == null ? null : s.UcjsName,
                };

        var tuc =
            from j in Context.TucJobs.AsNoTracking()
            where j.LinehaulRunId == runId && !j.UcjbVoid
                  // De-duplicate against the bulk branch; see the remarks above.
                  && !Context.TblBulkJobs.Any(
                         b => b.JobId == j.UcjbId && b.LinehaulRunId == runId && !b.Void)
            join t in Context.TucJobTypes.AsNoTracking() on j.UcjbSpeed equals t.UcjtId into ts
            from t in ts.DefaultIfEmpty()
            join g in Context.TucJobTypeGroupings.AsNoTracking() on t.GroupingId equals g.GroupingId into gs
            from g in gs.DefaultIfEmpty()
            join s in Context.Set<Domain.Despatch.TucJobStatus>().AsNoTracking() on j.UcjbStatus equals s.UcjsId into ss
            from s in ss.DefaultIfEmpty()
            select new StopRow
                {
                    Id = j.UcjbId,
                    Source = JobSources.Tuc,
                    JobNumber = j.UcjbNumber ?? string.Empty,
                    Pickup = j.UcjbFromAddr,
                    Drop = j.UcjbToAddr,
                    SpeedId = j.UcjbSpeed ?? 0,
                    SpeedShortName = t == null ? string.Empty : (t.ShortName ?? string.Empty),
                    SpeedName = t == null ? string.Empty : (t.UcjtName ?? string.Empty),
                    SpeedGroupingId = t == null ? null : (int?)t.GroupingId,
                    SpeedGroupingName = g == null ? null : g.GroupingName,
                    BookDate = j.UcjbDate,
                    BookTime = j.UcjbTime,
                    StatusName = s == null ? null : s.UcjsName,
                };

        return bulk.Concat(tuc);
    }

    /// <summary>Total ordering, which OFFSET/FETCH requires to be stable.
    /// BookDate and BookTime are nowhere near unique here - a busy run has
    /// thousands of stops on one date - so without a tie-break SQL Server may
    /// legitimately return one row on two consecutive pages and never return
    /// another. Source is ordered before Id because Id is only unique WITHIN a
    /// source; the pair is unique across the union.</summary>
    private static IQueryable<StopRow> Order(IQueryable<StopRow> q) => q
        .OrderByDescending(r => r.BookDate)
        .ThenByDescending(r => r.BookTime)
        .ThenBy(r => r.Source)
        .ThenBy(r => r.Id);

    private static BulkJobListItemDto Project(StopRow r) => new()
    {
        Id = r.Id,
        Source = r.Source,
        JobNumber = r.JobNumber,
        Pickup = r.Pickup,
        Drop = r.Drop,
        SpeedId = r.SpeedId,
        SpeedShortName = r.SpeedShortName,
        SpeedName = r.SpeedName,
        SpeedGroupingId = r.SpeedGroupingId,
        SpeedGroupingName = r.SpeedGroupingName,
        BookDate = r.BookDate?.ToString("yyyy-MM-dd"),
        BookTime = r.BookTime?.ToString("HH:mm"),
        StatusName = r.StatusName,
    };

    public async Task<BulkJobDetailDto?> GetDetailAsync(int jobId, string? source = null)
    {
        var src = JobSources.Normalise(source);
        var dto = src == JobSources.Tuc
            ? await TucDetailAsync(jobId)
            : await BulkDetailAsync(jobId);
        if (dto is not null)
        {
            // Reshape the "company|address" placeholder into "company, address" on
            // the client so EF doesn't have to translate string.Join.
            dto.PickupAddress = JoinAddress(dto.PickupAddress);
            dto.DropAddress = JoinAddress(dto.DropAddress);
        }
        return dto;
    }

    private async Task<BulkJobDetailDto?> BulkDetailAsync(int jobId)
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
                Source = JobSources.Bulk,
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
        return await q.FirstOrDefaultAsync();
    }

    /// <summary>Detail for a row that lives in tucJob.
    ///
    /// Company name comes from PickupAddressLine1 / DeliveryAddressLine1, not
    /// from a join: ucjbFrom is a suburb id (sys.foreign_keys shows
    /// tucJob.ucjbFrom -> tucSuburb.ucsuID), and the linehaul insert writes
    /// @LinehaulFromCompany into PickupAddressLine1 with lines 2..8 carrying
    /// Extra / StreetNumber / StreetName / City / State / ZipCode / Country.</summary>
    private async Task<BulkJobDetailDto?> TucDetailAsync(int jobId)
    {

        var q =
            from j in Context.TucJobs.AsNoTracking()
            where j.UcjbId == jobId
            join t in Context.TucJobTypes.AsNoTracking() on j.UcjbSpeed equals t.UcjtId into ts
            from t in ts.DefaultIfEmpty()
            join g in Context.TucJobTypeGroupings.AsNoTracking() on t.GroupingId equals g.GroupingId into gs
            from g in gs.DefaultIfEmpty()
            join st in Context.Set<Domain.Despatch.TucJobStatus>().AsNoTracking() on j.UcjbStatus equals st.UcjsId into sts
            from st in sts.DefaultIfEmpty()
            join lh in Context.TblbulkLinehaulRuns.AsNoTracking() on j.LinehaulRunId equals lh.Id into lhs
            from lh in lhs.DefaultIfEmpty()
            join c in Context.TucClients.AsNoTracking() on j.UcjbClientId equals c.UcclId into cs
            from c in cs.DefaultIfEmpty()
            select new BulkJobDetailDto
            {
                Id = j.UcjbId,
                Source = JobSources.Tuc,
                JobNumber = j.UcjbNumber ?? string.Empty,
                Customer = c == null ? string.Empty : (c.UcclName ?? string.Empty),
                StatusName = st == null ? string.Empty : (st.UcjsName ?? string.Empty),
                PickupAddress = (j.PickupAddressLine1 ?? string.Empty) + "|" + (j.UcjbFromAddr ?? string.Empty),
                DropAddress = (j.DeliveryAddressLine1 ?? string.Empty) + "|" + (j.UcjbToAddr ?? string.Empty),
                BookDate = j.UcjbDate.ToString("yyyy-MM-dd"),
                BookTime = j.UcjbTime == null ? null : j.UcjbTime.Value.ToString("HH:mm"),
                LinehaulRunName = lh == null ? null : lh.RunName,
                SpeedId = j.UcjbSpeed ?? 0,
                SpeedShortName = t == null ? string.Empty : (t.ShortName ?? string.Empty),
                SpeedName = t == null ? string.Empty : (t.UcjtName ?? string.Empty),
                SpeedGroupingId = t == null ? null : (int?)t.GroupingId,
                SpeedGroupingName = g == null ? null : g.GroupingName,
                // Same legacy rule as the bulk side: 0/1/2 = Booked/Assigned/
                // Accepted are still editable.
                SpeedEditable = (j.UcjbStatus ?? 0) <= 2,
                Notes = j.UcjbNotes,
            };
        return await q.FirstOrDefaultAsync();
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

    /// <summary>Patches the speed on whichever table the id belongs to.</summary>
    public async Task<BulkJobDetailDto?> UpdateSpeedAsync(int jobId, int speedId, string? source = null)
    {
        var src = JobSources.Normalise(source);

        if (src == JobSources.Tuc)
        {
            var tucJob = await Context.TucJobs.FirstOrDefaultAsync(j => j.UcjbId == jobId);
            if (tucJob is null) return null;
            tucJob.UcjbSpeed = speedId;
        }
        else
        {
            var job = await Context.TblBulkJobs.FirstOrDefaultAsync(j => j.BulkJobId == jobId);
            if (job is null) return null;
            job.Speed = speedId;
        }

        await Context.SaveChangesAsync();
        return await GetDetailAsync(jobId, src);
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
