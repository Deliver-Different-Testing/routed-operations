using System.Globalization;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Run;

/// <summary>
/// Read + CRUD side of the run life cycle. Lifted straight to EF LINQ from the
/// legacy JobRepository; the dispatch flow (send-to-live) still lives on
/// RunCommitService which calls UTL_stpJob_InsertFromRunBuilder via Dapper.
/// </summary>
public class RunService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    /// <summary>
    /// Read-side lift of `UTL_stpJob_tblBulkRunWithFilter`: returns all jobs that
    /// belong to an existing run for the filter set, grouped into RunDto rows.
    /// </summary>
    public async Task<List<RunDto>> GetBulkRunsAsync(
        DateTime? dateTime, string? clientIds, string? regionIds, string? ourRefs, string? speeds)
    {
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
                   WHERE breg.BulkRegionId IN ({inList})
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
        var parentIds = await Context.TblBulkJobs
            .AsNoTracking()
            .Where(child => child.ParentId != null)
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
        var runQuery = Context.TblBulkRuns.AsNoTracking().AsQueryable();
        if (dateTime.HasValue)
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
    /// Lock-a-run. Inserts a new tblBulkRun if ID is missing, otherwise updates
    /// in-place. Uses MERGE via a raw SQL upsert on tblBulkJobRun to keep the
    /// legacy anchor-run + HOLDLOCK behaviour for concurrent lockers.
    /// </summary>
    public async Task<(string Result, string Message)> InsertOrUpdateRunAsync(InsertOrUpdateRunRequest run)
    {
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
        var run = await Context.TblBulkRuns.FindAsync(id);
        // Legacy SP silently no-ops for missing run ids (delete is idempotent).
        // Return Success so callers can retry / re-issue without seeing spurious
        // failures - matches UTL_stpJob_tblBulkRun_Delete contract.
        if (run == null) return ("Success", "Run already deleted");

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
        await Context.SaveChangesAsync();

        Log.Information("Run {RunName} (id {RunId}) deleted; released {JobCount} job(s) back to unbuilt",
            run.Name, id, jobIds.Count);
        return ("Success", "Deleted");
    }

    /// <summary>
    /// Move a job to a different run. Preserves the legacy optimistic-concurrency
    /// check on fromRunId so simultaneous moves by two operators can't overwrite
    /// each other silently.
    /// </summary>
    public async Task<(string Result, string Message)> UpdateJobToRunAsync(int jobId, int? fromRunId, int runId, int? pickRunOrder = null)
    {
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
        var existing = await Context.TblBulkJobRuns
            .FirstOrDefaultAsync(x => x.BulkJobId == jobId);
        if (existing == null) return ("Failed", "Job is not on any run");

        Context.TblBulkJobRuns.Remove(existing);

        var jobRow = await Context.TblBulkJobs.FindAsync(jobId);
        if (jobRow != null) jobRow.BulkRunId = null;

        await Context.SaveChangesAsync();
        return ("Success", "Job removed from run");
    }

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
