using System.Data;
using System.Globalization;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Run;

/// <summary>
/// Read + CRUD side of the run life cycle. Lifted straight to EF LINQ from the
/// legacy JobRepository; the dispatch flow (send-to-live) still lives on
/// RunCommitService which calls UTL_stpJob_InsertFromRunBuilder via Dapper.
/// </summary>
public class RunService(IDbContextFactory<DynamicDespatchDbContext> contextFactory, IBranchScopeGuard branchGuard)
    : BaseService(contextFactory)
{
    // Branches B2c. A branch-limited user may act on a run when the run is fully theirs (its courier is theirs, or every job on it
    // is) or it is a fresh run with no jobs and no courier yet (so the user who creates a run can put the first job on it).
    private async Task<bool> CanActOnRunAsync(int runId)
    {
        if (!branchGuard.IsRestricted) return true;
        var run = await Context.TblBulkRuns.AsNoTracking().Where(r => r.Id == runId).Select(r => new { r.CourierId }).FirstOrDefaultAsync();
        if (run is null) return true;   // a missing run is the caller's existing "not found" path
        if (run.CourierId is null && !await Context.TblBulkJobRuns.AnyAsync(jr => jr.RunId == runId) && !await Context.TblBulkJobs.AnyAsync(j => j.BulkRunId == runId))
            return true;
        return await branchGuard.IsRunFullyVisibleAsync(runId);
    }

    // Branches B2c: may the caller move these jobs? The one rule for every job action (move, remove, dispatch, void, Route Viewer):
    // a job is the caller's to act on when it is visible, or it sits on a run whose courier is theirs. Where the job sits on a run
    // that is not fully theirs does not matter; whether the target run is theirs is a separate check (CanActOnRunAsync).
    private async Task<bool> CanMoveJobsAsync(IReadOnlyCollection<int> bulkJobIds)
    {
        if (!branchGuard.IsRestricted) return true;
        var ids = bulkJobIds.Distinct().ToList();
        if (ids.Count == 0) return true;
        return (await branchGuard.ActionableBulkJobIdsAsync(ids)).Count == ids.Count;
    }

    // Branches B2c: a branch-limited caller may only put a courier of their own on a run. Keeping the courier the run already has is
    // fine (renaming a run must not fail because an earlier editor chose a courier outside the caller's branches).
    private async Task<bool> CanUseCourierAsync(int? courierId, int? runId)
    {
        if (!branchGuard.IsRestricted || courierId is null) return true;
        if (runId is > 0)
        {
            var current = await Context.TblBulkRuns.AsNoTracking().Where(r => r.Id == runId).Select(r => r.CourierId).FirstOrDefaultAsync();
            if (current == courierId) return true;
        }
        return (await branchGuard.VisibleCourierIdsAsync([courierId.Value])).Contains(courierId.Value);
    }

    /// <summary>
    /// Read-side lift of `UTL_stpJob_tblBulkRunWithFilter`: returns all jobs that
    /// belong to an existing run for the filter set, grouped into RunDto rows.
    /// onlyRunIds (#1018 C2, see GetRunsByIdAsync) limits it to those runs.
    /// </summary>
    public async Task<List<RunDto>> GetBulkRunsAsync(
        DateTime? dateTime, string? clientIds, string? regionIds, string? ourRefs, string? speeds,
        IReadOnlyCollection<int>? onlyRunIds = null)
    {
        var onlyRunIdList = onlyRunIds?.ToList();
        // Phase 1 perf: pre-fetch the set of schedule IDs with AutoBook=true
        // in one indexed scan so the main query filters via a set lookup
        // instead of a correlated NOT EXISTS subquery evaluated per row.
        var autoBookScheduleIds = await Context.TblBulkRunSchedules
            .AsNoTracking()
            .Where(s => (s.AutoBook ?? false) == true)
            .Select(s => s.BulkRunScheduleId)
            .ToListAsync();
        var autoBookSet = new HashSet<int>(autoBookScheduleIds);

        // AsNoTracking - projection to RunDto downstream, no entity mutation.
        var jobQuery = Context.TblBulkJobs
            .AsNoTracking()
            .Where(j => j.BulkRunId.HasValue)
            .Where(j => onlyRunIdList == null || onlyRunIdList.Contains(j.BulkRunId!.Value))
            // Legacy filters (match UTL_stpJob_tblBulkRunWithFilter):
            //   ISNULL(Done, 0) = 0
            //   ISNULL(JobRelationshipTypeID, 0) <> 19  (linehaul siblings)
            //   NOT EXISTS (LH-job with schedule.InsertToBulk = 0)
            //   ISNULL(s.AutoBook, 0) = 0  (drop jobs on auto-book schedules)
            .Where(j => !j.Done)
            .Where(j => (j.JobRelationshipTypeId ?? 0) != 19)
            .Where(j => !(j.JobNumber != null && j.JobNumber.Contains("LH")
                          && Context.TblBulkScheduleLinehauls.Any(lh =>
                                lh.BulkRunScheduleId == j.ScheduleId
                                && (lh.InsertToBulk ?? false) == false)))
            .Where(j => !j.ScheduleId.HasValue || !autoBookSet.Contains(j.ScheduleId.Value))
            .AsQueryable();

        if (dateTime.HasValue)
        {
            var d = dateTime.Value.Date;
            jobQuery = jobQuery.Where(j => j.BookDate.Date == d);
        }

        var clientIdSet = ParseIntList(clientIds);
        if (clientIdSet.Count > 0)
            jobQuery = jobQuery.Where(j => clientIdSet.Contains(j.ClientId));

        var regionIdSet = ParseIntList(regionIds);
        if (regionIdSet.Count > 0)
        {
            // Mirror JobService's geospatial region-filter fix (R2.1). Legacy
            // SP filters via a lat/lng + fuzzy-address join to tblBulkRegion,
            // not tblBulkJob.RegionID. Raw SQL keeps the string normaliser
            // correct without EF LINQ contortions.
            //
            // Push the same date + Done narrowing filters here that the main
            // EF query applies, so we don't scan the whole tblBulkJob
            // (millions of rows on Urgent-Prod) just to feed the outer .Where.
            // Reported 2026-08-27: unfiltered scan timed out at 30s SQL
            // command timeout on Tenant 5, blocking the Route Builder load.
            var inList = string.Join(",", regionIdSet);
            var parameters = new List<SqlParameter>();
            var dateClause = string.Empty;
            if (dateTime.HasValue)
            {
                var d = dateTime.Value.Date;
                dateClause = " AND j.BookDate >= @dateStart AND j.BookDate < @dateEnd";
                parameters.Add(new SqlParameter("@dateStart", d));
                parameters.Add(new SqlParameter("@dateEnd", d.AddDays(1)));
            }
            var sql = $@"SELECT DISTINCT j.BulkJobID AS Value
                   FROM tblBulkJob j
                   LEFT JOIN tblBulkRegion breg
                     ON ((breg.PickupLatitude = j.PickUpLatitude
                       AND breg.PickupLongitude = j.PickUpLongitude)
                     OR LOWER(RTRIM(breg.FromAddress)) COLLATE DATABASE_DEFAULT
                        = LOWER(LTRIM(RTRIM(REPLACE(
                            REPLACE(
                              REPLACE(N' ' + j.FromAddress + N' ', ' ', '<>'),
                              '>st<', '>street<'),
                            '<>', ' '
                          )))) COLLATE DATABASE_DEFAULT)
                   WHERE ( breg.BulkRegionId IN ({inList})
                           -- Client-origin jobs (schedule-origin spec 4.1).
                           -- Their pickup is a client address, so they match
                           -- no tblBulkRegion row by coordinates or by name
                           -- and the join above drops them from every
                           -- region-filtered view. Admit them on the
                           -- schedule's origin region instead. Delivery jobs
                           -- are already found by Region.
                           --
                           -- Same shape Route Viewer already ships in
                           -- RVW_stpBulkRuns_2:193-206, including its
                           -- not-a-collection-job guard: a client-origin
                           -- schedule has no collection leg, so an LHP row
                           -- under one would be stale data, not something to
                           -- surface here.
                           OR ( UPPER(RTRIM(j.JobNumber)) NOT LIKE '%LHP'
                                AND EXISTS (
                                    SELECT 1
                                    FROM dbo.tblBulkRunSchedule s
                                    JOIN dbo.tblBulkRunScheduleHeader h
                                      ON h.ScheduleId = s.ScheduleId
                                    WHERE s.BulkRunScheduleId = j.ScheduleID
                                      AND h.OriginType = 'client'
                                      AND h.OriginRegionId IN ({inList})))
                           -- Direct-origin jobs (2026-10-08). Sibling of the
                           -- client-origin branch above and dropped by the
                           -- same join: a Direct job's pickup is whatever
                           -- address the booking declared, so it matches no
                           -- tblBulkRegion row. A Direct schedule has no
                           -- OriginRegionId (it is forced NULL), so admission
                           -- is on the job's OWN dispatch region instead.
                           --
                           -- COALESCE, not a bare tblBulkJob.RegionID, on
                           -- purpose: the Route Viewer region-filtering work
                           -- moves admission onto tucJob.DepotId with
                           -- RegionID as the fallback, and writing it that way
                           -- now means this clause does not have to be
                           -- revisited then. DO NOT reduce it to RegionID
                           -- alone. It changes nothing today - the branch only
                           -- evaluates for OriginType = 'direct' and no
                           -- schedule can be Direct until this ships, so it
                           -- matches zero existing rows.
                           --
                           -- Correlated subquery rather than a LEFT JOIN to
                           -- tucJob so the FROM clause the other branches rely
                           -- on is untouched.
                           OR ( EXISTS (
                                    SELECT 1
                                    FROM dbo.tblBulkRunSchedule s
                                    JOIN dbo.tblBulkRunScheduleHeader h
                                      ON h.ScheduleId = s.ScheduleId
                                    WHERE s.BulkRunScheduleId = j.ScheduleID
                                      AND h.OriginType = 'direct')
                                AND COALESCE(
                                      (SELECT tj.DepotId
                                         FROM dbo.tucJob tj
                                        WHERE tj.ucjbID = j.JobID),
                                      j.RegionID) IN ({inList}) ) )
                     AND ISNULL(j.Done, 0) = 0
                     {dateClause}";
            var jobIds = await Context.Database.SqlQueryRaw<int>(sql, parameters.ToArray()).ToListAsync();
            jobQuery = jobQuery.Where(j => jobIds.Contains(j.BulkJobId));
        }

        var ourRefSet = ParseStringList(ourRefs);
        if (ourRefSet.Count > 0)
            jobQuery = jobQuery.Where(j => j.OurRef != null && ourRefSet.Contains(j.OurRef));

        var speedSet = ParseIntList(speeds);
        if (speedSet.Count > 0)
            jobQuery = jobQuery.Where(j => speedSet.Contains(j.Speed));

        var jobs = await jobQuery.ToListAsync();

        // Any job whose id shows up as another job's ParentId is an EH/HD
        // parent - never surfaced to the operator. Kept out of the run's job
        // list so the Run Builder never renders one.
        //
        // #1018: only the jobs already loaded can be parents worth knowing
        // about, so ask about those ids alone (an index seek on
        // IX_tblBulkJob_ParentID per id). This used to pull every ParentID in
        // the table (123,235 on Urgent prod, Nov 2026) on every load. The
        // child is still looked up across the whole table, any day and any
        // state, so the parents hidden are the same.
        var loadedJobIds = jobs.Select(j => j.BulkJobId).ToList();
        var parentIds = await Context.TblBulkJobs
            .AsNoTracking()
            .Where(child => child.ParentId != null && loadedJobIds.Contains(child.ParentId.Value))
            .Select(child => child.ParentId!.Value)
            .Distinct()
            .ToListAsync();
        var parentSet = new HashSet<int>(parentIds);

        // Runs with jobs matching the filter.
        var runIdsWithJobs = jobs.Where(j => j.BulkRunId.HasValue)
            .Select(j => j.BulkRunId!.Value)
            .Distinct()
            .ToList();

        // Also include empty runs stamped for this date that are still in draft
        // state (Status = 0). Freshly-created runs (Create button) start at
        // Status = 0; dispatched runs sit at Status = 1 (Locked) or higher and
        // must NOT re-surface after their jobs went live.
        //
        // Discriminator by trial-and-error against DFRNT_SEED_CR after a real
        // dispatch:
        //   - `runIdsWithJobs.Contains` misses dispatched runs (their jobs are
        //     Done = 1 so the job query drops them - correct).
        //   - Previous "no tblBulkJobRun links" branch was wrong because
        //     UTL_stpJob_InsertFromTblBulkJob DOES delete the link rows on
        //     dispatch, leaving the run row with Status = 1 + zero links -
        //     indistinguishable from a fresh empty run by link count alone.
        //   - Status = 0 cleanly separates fresh drafts from dispatched runs
        //     because operators lock a run (Status = 1) before send-to-live.
        //     Void Jobs run (IsVoidRun = 1, Status = 1) never surfaces via this
        //     branch either, which is correct - it's only visible when it has
        //     voided jobs to render.
        //
        // Only when no job-level filter is active, though. Runs carry no
        // region / client / speed / ref of their own, so with a filter set the
        // draft branch surfaced every other region's drafts as 0-job rows
        // (reported 2026-09-22: Palmerston North filter listed Auckland runs).
        // With a filter, a run shows only if it holds a matching job.
        var hasJobFilter = clientIdSet.Count > 0 || regionIdSet.Count > 0
                           || ourRefSet.Count > 0 || speedSet.Count > 0;
        var runQuery = Context.TblBulkRuns.AsNoTracking().AsQueryable();
        if (onlyRunIdList != null)
        {
            runQuery = runQuery.Where(r => onlyRunIdList.Contains(r.Id));
        }
        else if (dateTime.HasValue && !hasJobFilter)
        {
            var d = dateTime.Value.Date;
            runQuery = runQuery.Where(r =>
                runIdsWithJobs.Contains(r.Id) ||
                (r.DespatchDateTime.HasValue
                 && r.DespatchDateTime.Value.Date == d
                 && (r.Status ?? 0) == 0));
        }
        else
        {
            runQuery = runQuery.Where(r => runIdsWithJobs.Contains(r.Id));
        }

        var runs = await runQuery.ToListAsync();

        // Branches B2c: branch-limited staff see a run when its courier is theirs (then all its jobs) or it holds a job of theirs (then only
        // those jobs). A run with no jobs and no courier is not branch data and stays visible.
        if (branchGuard.IsRestricted)
        {
            var visibleJobIds = await branchGuard.VisibleBulkJobIdsAsync(jobs.Select(j => j.BulkJobId).ToList());
            var courierIdsOfRuns = await branchGuard.VisibleCourierIdsAsync(
                runs.Where(r => r.CourierId.HasValue).Select(r => r.CourierId!.Value).Distinct().ToList());
            var jobsByRun = jobs.Where(j => j.BulkRunId.HasValue).GroupBy(j => j.BulkRunId!.Value).ToDictionary(g => g.Key, g => g.ToList());
            var keptRuns = new List<TblBulkRun>();
            var hiddenJobIds = new HashSet<int>();
            foreach (var r in runs)
            {
                var runJobs = jobsByRun.GetValueOrDefault(r.Id) ?? [];
                var courierIsTheirs = r.CourierId.HasValue && courierIdsOfRuns.Contains(r.CourierId.Value);
                var anyJobIsTheirs = runJobs.Any(j => visibleJobIds.Contains(j.BulkJobId));
                var emptyAndUnassigned = runJobs.Count == 0 && !r.CourierId.HasValue;
                if (courierIsTheirs || anyJobIsTheirs || emptyAndUnassigned)
                {
                    keptRuns.Add(r);
                    if (!courierIsTheirs)
                        foreach (var j in runJobs.Where(j => !visibleJobIds.Contains(j.BulkJobId))) hiddenJobIds.Add(j.BulkJobId);
                }
                else
                {
                    foreach (var j in runJobs) hiddenJobIds.Add(j.BulkJobId);
                }
            }

            runs = keptRuns;
            jobs = [.. jobs.Where(j => !hiddenJobIds.Contains(j.BulkJobId))];
        }

        var courierIds = runs.Where(r => r.CourierId.HasValue).Select(r => r.CourierId!.Value).ToList();
        // Add every per-job courier id too so the Run Builder pane can render
        // the Courier column on each row without a second round-trip.
        var jobCourierIds = jobs.Where(j => j.CourierId.HasValue).Select(j => j.CourierId!.Value).Distinct();
        var allCourierIds = courierIds.Concat(jobCourierIds).Distinct().ToList();
        var couriers = await Context.TucCouriers
            .AsNoTracking()
            .Where(c => allCourierIds.Contains(c.UccrId))
            .ToListAsync();
        var courierById = couriers.ToDictionary(c => c.UccrId, c => (c.Code + " " + c.UccrName).Trim());

        // Fleet name lookup for the run's assigned courier. Legacy SP: LEFT
        // JOIN tucCourierFleet f ON c.CourierFleetID = f.UccfID -> f.UccfName.
        var fleetIds = couriers.Where(c => c.CourierFleetId.HasValue)
            .Select(c => c.CourierFleetId!.Value).Distinct().ToList();
        var fleets = await Context.TucCourierFleets
            .AsNoTracking()
            .Where(f => fleetIds.Contains(f.UccfId))
            .ToDictionaryAsync(f => f.UccfId, f => f.UccfName);
        var fleetByCourier = couriers
            .Where(c => c.CourierFleetId.HasValue && fleets.ContainsKey(c.CourierFleetId.Value))
            .ToDictionary(c => c.UccrId, c => fleets[c.CourierFleetId!.Value]);

        // Speed name lookup for the Run Builder Speed column.
        var speedIds = jobs.Select(j => j.Speed).Distinct().ToList();
        var speedNames = await Context.TucJobTypes
            .AsNoTracking()
            .Where(s => speedIds.Contains(s.UcjtId))
            .ToDictionaryAsync(s => s.UcjtId, s => s.UcjtName);

        // Per-run-per-job IsStart / IsEnd flags. Loaded once, indexed by
        // (BulkJobId, RunId) so the per-run projection can pick them up.
        var runIds = runs.Select(r => r.Id).ToList();
        var jobRuns = await Context.TblBulkJobRuns
            .AsNoTracking()
            .Where(jr => jr.RunId.HasValue && runIds.Contains(jr.RunId.Value)
                      && jr.BulkJobId.HasValue)
            .Select(jr => new { jr.BulkJobId, jr.RunId, jr.IsStart, jr.IsEnd })
            .ToListAsync();
        var startEndByRunJob = jobRuns.ToDictionary(
            x => (x.RunId!.Value, x.BulkJobId!.Value),
            x => (x.IsStart, x.IsEnd));

        return runs
            .OrderBy(r => r.Id) // Legacy SP: ORDER BY r.ID
            .Select(r => new RunDto
            {
                Id = r.Id,
                Name = r.Name,
                Mins = r.Mins,
                Kms = r.Kms,
                CourierId = r.CourierId,
                CourierName = r.CourierId.HasValue && courierById.TryGetValue(r.CourierId.Value, out var cn)
                    ? cn
                    : null,
                Fleet = r.CourierId.HasValue && fleetByCourier.TryGetValue(r.CourierId.Value, out var flt)
                    ? flt
                    : null,
                Status = r.Status,
                Revenue = r.Revenue,
                Payout = r.Payout,
                CourierPercentage = r.CourierPercentage,
                GoogleRouteResponse = r.GoogleRouteResponse,
                DespatchDateTime = r.DespatchDateTime,
                NoReroute = r.NoReroute,
                RoutingMode = r.RoutingMode,
                FinishAtBulkJobId = r.FinishAtBulkJobId,
                IsVoidRun = r.IsVoidRun,
                // Filter out invisible parent EH/HD jobs so the Run Builder
                // panel only shows the child rows the operator can actually see
                // in the Jobs list. Matches the parent filter in JobService.
                Jobs = jobs
                    .Where(j => j.BulkRunId == r.Id)
                    .Where(j => !parentSet.Contains(j.BulkJobId))
                    // NULL RunOrder placed FIRST to match SQL ASC NULLS FIRST
                    // (legacy SP behaviour) - unassigned rows sit above the
                    // ordered ones. See R2.5 for the JobService equivalent.
                    .OrderBy(j => j.RunOrder ?? int.MinValue)
                    .Select(j => new RunJobDto
                    {
                        BulkJobId = j.BulkJobId,
                        BuilderIndex = j.RunOrder,
                        JobNumber = j.JobNumber,
                        IsStart = startEndByRunJob.TryGetValue((r.Id, j.BulkJobId), out var se) && se.IsStart,
                        IsEnd = startEndByRunJob.TryGetValue((r.Id, j.BulkJobId), out var se2) && se2.IsEnd,
                        ClientCode = j.ClientCode,
                        DeliveryDate = j.BookDate,
                        BookTime = j.BookTime.ToString("HH:mm:ss"),
                        ToAddress = j.ToAddress,
                        ToSuburb = j.ToSuburb,
                        ToPostCode = j.ToPostCode,
                        CourierName = j.CourierId.HasValue && courierById.TryGetValue(j.CourierId.Value, out var jcn)
                            ? jcn
                            : null,
                        SpeedName = speedNames.TryGetValue(j.Speed, out var sn) ? sn : null,
                        DeliveryLatitude = j.DeliveryLatitude,
                        Amount = j.Amount,
                    })
                    .ToList()
            })
            .ToList();
    }

    /// <summary>
    /// #1018 C2: the given runs exactly as GET /api/runs shows them, so a
    /// Route Builder save can hand back the runs it touched and the cockpit
    /// patches its lists instead of waiting on a full reload. No job filter:
    /// a touched run comes back with all its jobs (the background reload that
    /// follows re-applies the operator's filters).
    /// </summary>
    public Task<List<RunDto>> GetRunsByIdAsync(IReadOnlyCollection<int> runIds) =>
        runIds.Count == 0
            ? Task.FromResult(new List<RunDto>())
            : GetBulkRunsAsync(null, null, null, null, null, onlyRunIds: runIds);

    /// <summary>
    /// Lock-a-run. Inserts a new tblBulkRun if ID is missing, otherwise updates
    /// in-place. Uses MERGE via a raw SQL upsert on tblBulkJobRun to keep the
    /// legacy anchor-run + HOLDLOCK behaviour for concurrent lockers.
    /// </summary>
    public async Task<(string Result, string Message)> InsertOrUpdateRunAsync(InsertOrUpdateRunRequest run)
    {
        if (run.Id.HasValue && !await CanActOnRunAsync(run.Id.Value)) return ("Failed", "Run not found");   // Branches B2c
        // Branches B2c: the jobs this call pulls onto the run must be the caller's to move (a new run has no id, so check them here).
        if (run.Jobs.Count > 0 && !await CanMoveJobsAsync([.. run.Jobs.Select(j => j.BulkJobId)])) return ("Failed", "Job not found");
        if (!await CanUseCourierAsync(run.Courier?.CourierId, run.Id)) return ("Failed", "Courier not found");

        float courierPercentage = 0;
        if (!string.IsNullOrEmpty(run.CourierPercent) && run.CourierPercent != "NaN%")
        {
            courierPercentage = float.Parse(
                run.CourierPercent.TrimEnd('%', ' '),
                CultureInfo.InvariantCulture) / 100f;
        }

        // Legacy SP accepts nvarchar(max) as-is. Our DTO takes `object?` so the
        // React caller can send either a live route object OR the already-
        // serialised string it round-tripped from the last GET. Double-serialise
        // would wrap the string in an outer set of quotes - guard against it.
        var googleRouteJson = run.GoogleRouteResponse is string s
            ? s
            : JsonConvert.SerializeObject(run.GoogleRouteResponse);
        TblBulkRun? entity;

        if (!run.Id.HasValue || run.Id.Value == 0)
        {
            entity = new TblBulkRun
            {
                Name = run.Name,
                Mins = run.Mins,
                Kms = run.Kms,
                CourierId = run.Courier?.CourierId,
                // Legacy SP: ISNULL(@Status, 0) - null defaults to 0 (draft).
                Status = run.Status ?? 0,
                Revenue = run.Revenue,
                Payout = run.Payout,
                CourierPercentage = courierPercentage,
                GoogleRouteResponse = googleRouteJson,
                DespatchDateTime = run.DespatchDateTime,
                NoReroute = run.NoReroute ?? false,
                RoutingMode = run.RoutingMode ?? (byte)0,
                FinishAtBulkJobId = run.FinishAtBulkJobId,
                Created = DateTime.Now,
                LastModified = DateTime.Now
            };
            Context.TblBulkRuns.Add(entity);
            await Context.SaveChangesAsync();
        }
        else
        {
            entity = await Context.TblBulkRuns.FindAsync(run.Id.Value);
            if (entity == null)
                return ("Failed", "Run not found");

            entity.Name = run.Name;
            entity.Mins = run.Mins;
            entity.Kms = run.Kms;
            entity.CourierId = run.Courier?.CourierId;
            entity.Status = run.Status ?? 0;
            entity.Revenue = run.Revenue;
            entity.Payout = run.Payout;
            entity.CourierPercentage = courierPercentage;
            entity.GoogleRouteResponse = googleRouteJson;
            if (run.NoReroute.HasValue) entity.NoReroute = run.NoReroute.Value;
            if (run.RoutingMode.HasValue) entity.RoutingMode = run.RoutingMode.Value;
            if (run.FinishAtBulkJobId.HasValue || run.RoutingMode == 2)
                entity.FinishAtBulkJobId = run.FinishAtBulkJobId;
            entity.LastModified = DateTime.Now;
            await Context.SaveChangesAsync();
        }

        foreach (var job in run.Jobs)
        {
            // Preserve the legacy MERGE + HOLDLOCK contract so concurrent lockers
            // of the same run don't leave the row bound to a stale RunID.
            await Context.Database.ExecuteSqlRawAsync(@"
                MERGE tblBulkJobRun WITH (HOLDLOCK) AS target
                USING (SELECT @BulkJobID AS BulkJobID) AS source
                ON target.BulkJobID = source.BulkJobID
                WHEN MATCHED THEN
                    UPDATE SET RunID = @RunID, PickRunOrder = @PickRunOrder
                WHEN NOT MATCHED THEN
                    INSERT (RunID, BulkJobID, PickRunOrder)
                    VALUES (@RunID, @BulkJobID, @PickRunOrder);

                UPDATE tblBulkJob SET BulkRunID = @RunID, RunOrder = @PickRunOrder
                WHERE BulkJobID = @BulkJobID;",
                new SqlParameter("@RunID", entity.Id),
                new SqlParameter("@BulkJobID", job.BulkJobId),
                new SqlParameter("@PickRunOrder", (object?)job.BuilderIndex ?? DBNull.Value));
        }

        Log.Information("Run {RunName} locked/updated with {JobCount} jobs", run.Name, run.Jobs.Count);
        return ("Success", entity.Id.ToString(CultureInfo.InvariantCulture));
    }

    public async Task<(string Result, string Message)> UpdateRunAsync(InsertOrUpdateRunRequest run)
    {
        if (!run.Id.HasValue) return ("Failed", "Missing run id");
        if (!await CanActOnRunAsync(run.Id.Value)) return ("Failed", "Run not found");   // Branches B2c
        if (!await CanUseCourierAsync(run.Courier?.CourierId, run.Id)) return ("Failed", "Courier not found");

        var runToUpdate = await Context.TblBulkRuns.FindAsync(run.Id.Value);
        if (runToUpdate == null) return ("Failed", "Run not found");

        float courierPercentage = 0;
        if (!string.IsNullOrEmpty(run.CourierPercent) && run.CourierPercent != "NaN%")
        {
            courierPercentage = float.Parse(
                run.CourierPercent.TrimEnd('%', ' '),
                CultureInfo.InvariantCulture) / 100f;
        }

        runToUpdate.Name = run.Name;
        runToUpdate.Mins = run.Mins;
        runToUpdate.Kms = run.Kms;
        runToUpdate.CourierId = run.Courier?.CourierId;
        runToUpdate.Status = run.Status ?? 0;
        runToUpdate.Revenue = run.Revenue;
        runToUpdate.Payout = run.Payout;
        runToUpdate.CourierPercentage = courierPercentage;
        runToUpdate.GoogleRouteResponse = run.GoogleRouteResponse is string s
            ? s
            : JsonConvert.SerializeObject(run.GoogleRouteResponse);
        if (run.NoReroute.HasValue) runToUpdate.NoReroute = run.NoReroute.Value;
        if (run.RoutingMode.HasValue) runToUpdate.RoutingMode = run.RoutingMode.Value;
        if (run.FinishAtBulkJobId.HasValue || run.RoutingMode == 2)
            runToUpdate.FinishAtBulkJobId = run.FinishAtBulkJobId;
        runToUpdate.LastModified = DateTime.Now;

        await Context.SaveChangesAsync();

        Log.Information("Run {RunName} metadata updated", run.Name);
        return ("Success", runToUpdate.Id.ToString(CultureInfo.InvariantCulture));
    }

    public async Task<(string Result, string Message)> DeleteAsync(int id)
    {
        if (!await CanActOnRunAsync(id)) return ("Failed", "Run not found");   // Branches B2c: outside the caller's branches
        var run = await Context.TblBulkRuns.FindAsync(id);
        // Legacy SP silently no-ops for missing run ids (delete is idempotent).
        // Return Success so callers can retry / re-issue without seeing spurious
        // failures - matches UTL_stpJob_tblBulkRun_Delete contract.
        if (run == null) return ("Success", "Run already deleted");

        var released = await RemoveRunTrackedAsync(run);
        await Context.SaveChangesAsync();

        Log.Information("Run {RunName} (id {RunId}) deleted; released {JobCount} job(s) back to unbuilt",
            run.Name, id, released);
        return ("Success", "Deleted");
    }

    /// <summary>
    /// Stages a run delete on the change tracker (no SaveChanges) so callers
    /// can fold it into a wider transaction. Returns the released job count.
    /// </summary>
    private async Task<int> RemoveRunTrackedAsync(TblBulkRun run)
    {
        var id = run.Id;
        var jobRuns = await Context.TblBulkJobRuns
            .Where(jr => jr.RunId == id)
            .ToListAsync();
        var jobIds = jobRuns.Where(jr => jr.BulkJobId.HasValue)
            .Select(jr => jr.BulkJobId!.Value)
            .Distinct()
            .ToList();

        // Denormalise the release back onto tblBulkJob so the cockpit's
        // Jobs list surfaces them again as unbuilt (BulkRunId is what our
        // displayedJobs filter and legacy inBuilder flag hinge on). Without
        // this the jobs stay "attached" to the deleted run id and disappear
        // from every pane. RunOrder is also cleared so the next assign
        // doesn't inherit a stale sequence number.
        if (jobIds.Count > 0)
        {
            var jobs = await Context.TblBulkJobs
                .Where(j => jobIds.Contains(j.BulkJobId) && j.BulkRunId == id)
                .ToListAsync();
            foreach (var j in jobs)
            {
                j.BulkRunId = null;
                j.RunOrder = null;
            }
        }

        Context.TblBulkJobRuns.RemoveRange(jobRuns);
        Context.TblBulkRuns.Remove(run);
        return jobIds.Count;
    }

    /// <summary>
    /// Create a run and assign its jobs in one transaction. Replaces the
    /// cockpit's "create empty run, then N parallel assign calls" sequence,
    /// which committed the run before any job moved and could leave a run with
    /// half its jobs (or none) when an assign deadlocked. Reported 2026-09-22
    /// ("Create Run from these xx jobs" lost every job). All-or-nothing: if any
    /// job fails, the run insert rolls back too.
    /// </summary>
    public async Task<(string Result, string Message)> CreateRunWithJobsAsync(InsertOrUpdateRunRequest run)
    {
        if (run.Id is > 0) return ("Failed", "Create-with-jobs only creates new runs");

        var items = run.Jobs
            .GroupBy(j => j.BulkJobId)
            .Select(g => new AssignJobItem { JobId = g.Key, PickRunOrder = g.First().BuilderIndex })
            .ToList();
        if (items.Count == 0) return ("Failed", "No jobs to assign");
        if (!await CanMoveJobsAsync([.. items.Select(i => i.JobId)])) return ("Failed", "Job not found");   // Branches B2c

        try
        {
            return await WithAssignDeadlockRetryAsync("CreateRunWithJobs", "new", async () =>
            {
                // #1018 C4: ReadCommitted plus row locks (RunAssignLocks), not Serializable.
                await using var tx = await Context.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
                run.Jobs = new List<RunJobDto>();
                var (result, message) = await InsertOrUpdateRunAsync(run);
                if (result != "Success") return (result, message);
                var runId = int.Parse(message, CultureInfo.InvariantCulture);

                var error = await StageJobAssignmentsAsync(runId, items);
                if (error != null) return ("Failed", error); // dispose rolls back the run insert

                await Context.SaveChangesAsync();
                await tx.CommitAsync();

                Log.Information("Run {RunName} (id {RunId}) created with {JobCount} job(s)", run.Name, runId, items.Count);
                return ("Success", runId.ToString(CultureInfo.InvariantCulture));
            });
        }
        catch (Exception ex)
        {
            Log.Error(ex, "CreateRunWithJobs {RunName} failed and rolled back; job ids {JobIds}",
                run.Name, items.Select(i => i.JobId));
            throw;
        }
    }

    /// <summary>
    /// Assign many jobs to an existing run in one transaction. With
    /// deleteRunId set this is a merge: the source run is deleted in the same
    /// transaction, so it only disappears if every job actually moved.
    /// </summary>
    public async Task<(string Result, string Message)> AssignJobsToRunAsync(
        int runId, IReadOnlyList<AssignJobItem> jobs, int? deleteRunId = null)
    {
        var items = jobs.GroupBy(j => j.JobId).Select(g => g.First()).ToList();
        if (items.Count == 0) return ("Failed", "No jobs to assign");
        if (deleteRunId == runId) return ("Failed", "Cannot merge a run into itself");

        // Branches B2c: the target run, the run being merged away, and every job must be the caller's.
        if (!await CanActOnRunAsync(runId) || (deleteRunId.HasValue && !await CanActOnRunAsync(deleteRunId.Value))
            || !await CanMoveJobsAsync([.. items.Select(i => i.JobId)]))
            return ("Failed", "Run or job not found");

        try
        {
            var runIds = deleteRunId.HasValue ? $"{runId} (merging {deleteRunId})" : runId.ToString(CultureInfo.InvariantCulture);
            return await WithAssignDeadlockRetryAsync("AssignJobsToRun", runIds, async () =>
            {
                // #1018 C4: ReadCommitted plus row locks (RunAssignLocks), not Serializable.
                await using var tx = await Context.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
                var error = await StageJobAssignmentsAsync(runId, items);
                if (error != null) return ("Failed", error);
                await Context.SaveChangesAsync();

                if (deleteRunId.HasValue)
                {
                    var source = await Context.TblBulkRuns.FindAsync(deleteRunId.Value);
                    if (source != null)
                    {
                        await RemoveRunTrackedAsync(source);
                        await Context.SaveChangesAsync();
                    }
                }

                await tx.CommitAsync();

                Log.Information("Assigned {JobCount} job(s) to run {RunId}; merged-from run {DeleteRunId}",
                    items.Count, runId, deleteRunId);
                return ("Success", items.Count.ToString(CultureInfo.InvariantCulture));
            });
        }
        catch (Exception ex)
        {
            Log.Error(ex, "AssignJobsToRun {RunId} failed and rolled back; job ids {JobIds}",
                runId, items.Select(i => i.JobId));
            throw;
        }
    }

    /// <summary>
    /// #1018 (Steve 26 Nov): attempts an assign gets when SQL Server picks it as
    /// the deadlock victim (1205). 2 = one retry. Since C4 the assign locks
    /// tblBulkJobRun before tblBulkJob while EF SaveChanges paths and several
    /// legacy procs take tblBulkJob first, so a victim is possible (see
    /// RunAssignLocks); a moment later the same assign normally goes through.
    /// </summary>
    public const int MaxAssignDeadlockAttempts = 2;

    /// <summary>
    /// Runs one assign unit of work (its own transaction, locks and fromRunId
    /// check), and on a 1205 runs the whole of it again, never the rest of the
    /// failed attempt. SQL Server has already rolled the victim back and the
    /// unit's transaction is disposed by the time this catches; the change
    /// tracker still holds the first attempt's staged rows (a link already
    /// moved in memory would fail the fromRunId check), so it is cleared before
    /// the retry. The run-changed conflict and every other error are not
    /// retried; the last 1205 surfaces unchanged.
    /// </summary>
    private async Task<(string Result, string Message)> WithAssignDeadlockRetryAsync(
        string operation, string runIds, Func<Task<(string Result, string Message)>> unitOfWork)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await unitOfWork();
            }
            catch (Exception ex) when (attempt < MaxAssignDeadlockAttempts && IsDeadlockVictim(ex))
            {
                Context.ChangeTracker.Clear();
                Log.Warning(ex, "{Operation} run {RunIds} was the deadlock victim (1205) on attempt {Attempt} of {MaxAttempts}; retrying",
                    operation, runIds, attempt, MaxAssignDeadlockAttempts);
            }
        }
    }

    /// <summary>1205 raised by a raw statement, or wrapped by EF SaveChanges (DbUpdateException).</summary>
    private static bool IsDeadlockVictim(Exception ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
            if (e is SqlException { Number: 1205 }) return true;
        return false;
    }

    /// <summary>
    /// EF equivalent of the per-job tblBulkJobRun MERGE + tblBulkJob mirror
    /// update, staged on the change tracker for the caller's transaction
    /// (ReadCommitted; the jobs' rows are locked first, see RunAssignLocks).
    /// Returns an operator-facing error (and logs the job ids) when the batch
    /// can't be applied as a whole; null on success.
    /// </summary>
    private async Task<string?> StageJobAssignmentsAsync(int runId, IReadOnlyList<AssignJobItem> items)
    {
        if (!await Context.TblBulkRuns.AnyAsync(r => r.Id == runId))
            return "Run not found. Please refresh.";

        var ids = items.Select(i => i.JobId).ToList();
        // #1018 C4: on SQL Server the link rows and then the job rows are
        // locked (and the links read) before anything else, so the fromRunId
        // check below sees the result of any other assign of these jobs. See
        // RunAssignLocks. SQLite (tests) locks the whole database for a write
        // transaction and takes no hints.
        List<TblBulkJobRun> links;
        if (IsSqlServer())
        {
            links = [];
            foreach (var (sql, args) in RunAssignLocks.LinkRowCommands(ids))
                links.AddRange(await Context.TblBulkJobRuns.FromSqlRaw(sql, args).ToListAsync());
            foreach (var (sql, args) in RunAssignLocks.JobRowCommands(ids))
                await Context.Database.ExecuteSqlRawAsync(sql, args);
        }
        else
        {
            links = await Context.TblBulkJobRuns
                .Where(l => l.BulkJobId.HasValue && ids.Contains(l.BulkJobId.Value))
                .ToListAsync();
        }

        var jobs = await Context.TblBulkJobs.Where(j => ids.Contains(j.BulkJobId)).ToListAsync();
        var missing = ids.Except(jobs.Select(j => j.BulkJobId)).ToList();
        if (missing.Count > 0)
        {
            Log.Warning("Assign to run {RunId} aborted; bulk job ids not found: {JobIds}", runId, missing);
            return $"{missing.Count} job(s) no longer exist. Please refresh.";
        }

        // Same optimistic-concurrency rule as UpdateJobToRunAsync, applied to
        // the whole batch: one stale job fails the lot.
        var conflicts = items
            .Where(i => i.FromRunId.HasValue)
            .Where(i => links.FirstOrDefault(l => l.BulkJobId == i.JobId) is { } l && l.RunId != i.FromRunId)
            .Select(i => i.JobId)
            .ToList();
        if (conflicts.Count > 0)
        {
            Log.Warning("Assign to run {RunId} aborted; jobs moved by another user: {JobIds}", runId, conflicts);
            return "Job has been moved by another user. Please refresh.";
        }

        foreach (var item in items)
        {
            var jobLinks = links.Where(l => l.BulkJobId == item.JobId).ToList();
            if (jobLinks.Count == 0)
            {
                Context.TblBulkJobRuns.Add(new TblBulkJobRun
                {
                    RunId = runId, BulkJobId = item.JobId, PickRunOrder = item.PickRunOrder
                });
            }
            foreach (var link in jobLinks)
            {
                link.RunId = runId;
                link.PickRunOrder = item.PickRunOrder;
            }

            var job = jobs.First(j => j.BulkJobId == item.JobId);
            job.BulkRunId = runId;
            job.RunOrder = item.PickRunOrder;
        }
        return null;
    }

    /// <summary>
    /// Move a job to a different run. Preserves the legacy optimistic-concurrency
    /// check on fromRunId so simultaneous moves by two operators can't overwrite
    /// each other silently.
    /// </summary>
    public async Task<(string Result, string Message)> UpdateJobToRunAsync(int jobId, int? fromRunId, int runId, int? pickRunOrder = null)
    {
        if (!await CanMoveJobsAsync([jobId]) || !await CanActOnRunAsync(runId)) return ("Failed", "Run or job not found");   // Branches B2c

        // Optimistic-concurrency check on fromRunId. Legacy SP does not do
        // this but the check helps two-operator scenarios flag conflicts
        // instead of silently overwriting. Only fires when the caller passes
        // a fromRunId - single-drop assigns from an unassigned pool skip it.
        if (fromRunId.HasValue)
        {
            var existing = await Context.TblBulkJobRuns.AsNoTracking()
                .FirstOrDefaultAsync(x => x.BulkJobId == jobId);
            if (existing != null && existing.RunId != fromRunId.Value)
            {
                Log.Warning("UpdateJobToRun conflict: BulkJobId {JobId} expected on run {FromRunId} but is on {ActualRunId}",
                    jobId, fromRunId, existing.RunId);
                return ("Failed", "Job has been moved by another user. Please refresh.");
            }
        }

        // MERGE + HOLDLOCK on tblBulkJobRun, then mirror onto tblBulkJob. Direct
        // port of legacy UTL_stpJob_tblBulkJobRun_InsertOrUpdate. Loses the EF
        // change-tracker but wins the race safety two operators can hit when
        // moving different jobs onto the same run simultaneously.
        await Context.Database.ExecuteSqlRawAsync(@"
            MERGE tblBulkJobRun WITH (HOLDLOCK) AS target
            USING (SELECT @BulkJobID AS BulkJobID) AS source
            ON target.BulkJobID = source.BulkJobID
            WHEN MATCHED THEN
                UPDATE SET RunID = @RunID, PickRunOrder = @PickRunOrder
            WHEN NOT MATCHED THEN
                INSERT (RunID, BulkJobID, PickRunOrder)
                VALUES (@RunID, @BulkJobID, @PickRunOrder);

            UPDATE tblBulkJob SET BulkRunID = @RunID, RunOrder = @PickRunOrder
            WHERE BulkJobID = @BulkJobID;",
            new SqlParameter("@RunID", runId),
            new SqlParameter("@BulkJobID", jobId),
            new SqlParameter("@PickRunOrder", (object?)pickRunOrder ?? DBNull.Value));

        return ("Success", jobId.ToString(CultureInfo.InvariantCulture));
    }

    /// <summary>
    /// Set (or clear) the isStart / isEnd flags on a single tblBulkJobRun row.
    /// Legacy analogue: $scope.setJobEndFromMap / setJobStartFromMap +
    /// runBuilderMenu Toggle end point / Toggle start point.
    /// Only one row per run can be flagged Start; same for End. Setting one
    /// clears any previous Start (or End) on the same run.
    /// </summary>
    public async Task<(string Result, string Message)> SetJobStartEndAsync(int runId, int jobId, bool? isStart, bool? isEnd)
    {
        if (!await CanActOnRunAsync(runId)) return ("Failed", "Run not found");   // Branches B2c

        var jobRuns = await Context.TblBulkJobRuns
            .Where(jr => jr.RunId == runId)
            .ToListAsync();
        var target = jobRuns.FirstOrDefault(x => x.BulkJobId == jobId);
        if (target == null) return ("Failed", "Job is not on the run");

        if (isStart.HasValue)
        {
            var newValue = isStart.Value;
            // Clear any other start on this run first.
            if (newValue)
            {
                foreach (var jr in jobRuns.Where(x => x.BulkJobId != jobId && x.IsStart))
                    jr.IsStart = false;
            }
            target.IsStart = newValue;
        }
        if (isEnd.HasValue)
        {
            var newValue = isEnd.Value;
            if (newValue)
            {
                foreach (var jr in jobRuns.Where(x => x.BulkJobId != jobId && x.IsEnd))
                    jr.IsEnd = false;
            }
            target.IsEnd = newValue;
        }
        await Context.SaveChangesAsync();
        return ("Success", jobId.ToString(CultureInfo.InvariantCulture));
    }

    public async Task<(string Result, string Message)> RemoveJobFromRunAsync(int jobId)
    {
        if (!await CanMoveJobsAsync([jobId])) return ("Failed", "Job not found");   // Branches B2c

        var existing = await Context.TblBulkJobRuns
            .FirstOrDefaultAsync(x => x.BulkJobId == jobId);
        if (existing == null) return ("Failed", "Job is not on any run");

        Context.TblBulkJobRuns.Remove(existing);

        var jobRow = await Context.TblBulkJobs.FindAsync(jobId);
        if (jobRow != null) jobRow.BulkRunId = null;

        await Context.SaveChangesAsync();
        return ("Success", "Job removed from run");
    }

    private bool IsSqlServer() =>
        Context.Database.ProviderName?.Contains("SqlServer", StringComparison.OrdinalIgnoreCase) == true;

    private static List<int> ParseIntList(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return new List<int>();
        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s.Trim())
            .Where(s => int.TryParse(s, out _))
            .Select(int.Parse)
            .ToList();
    }

    private static List<string> ParseStringList(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return new List<string>();
        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s.Trim())
            .Where(s => !string.IsNullOrEmpty(s))
            .ToList();
    }
}
