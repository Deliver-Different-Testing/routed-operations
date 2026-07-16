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
        var jobQuery = Context.TblBulkJobs
            .Where(j => j.BulkRunId.HasValue)
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
            jobQuery = jobQuery.Where(j => j.RegionId.HasValue && regionIdSet.Contains(j.RegionId.Value));

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

        // Also include empty runs stamped for this date (freshly created via the
        // Create button, no jobs yet - operators expect to see them so they can
        // start dragging jobs in).
        var runQuery = Context.TblBulkRuns.AsQueryable();
        if (dateTime.HasValue)
        {
            var d = dateTime.Value.Date;
            runQuery = runQuery.Where(r =>
                runIdsWithJobs.Contains(r.Id) ||
                (r.DespatchDateTime.HasValue && r.DespatchDateTime.Value.Date == d));
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
            .Where(c => allCourierIds.Contains(c.UccrId))
            .ToListAsync();
        var courierById = couriers.ToDictionary(c => c.UccrId, c => (c.Code + " " + c.UccrName).Trim());

        // Speed name lookup for the Run Builder Speed column.
        var speedIds = jobs.Select(j => j.Speed).Distinct().ToList();
        var speedNames = await Context.TucJobTypes
            .Where(s => speedIds.Contains(s.UcjtId))
            .ToDictionaryAsync(s => s.UcjtId, s => s.UcjtName);

        // Per-run-per-job IsStart / IsEnd flags. Loaded once, indexed by
        // (BulkJobId, RunId) so the per-run projection can pick them up.
        var runIds = runs.Select(r => r.Id).ToList();
        var jobRuns = await Context.TblBulkJobRuns
            .Where(jr => jr.RunId.HasValue && runIds.Contains(jr.RunId.Value)
                      && jr.BulkJobId.HasValue)
            .Select(jr => new { jr.BulkJobId, jr.RunId, jr.IsStart, jr.IsEnd })
            .ToListAsync();
        var startEndByRunJob = jobRuns.ToDictionary(
            x => (x.RunId!.Value, x.BulkJobId!.Value),
            x => (x.IsStart, x.IsEnd));

        return runs
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
                    .OrderBy(j => j.RunOrder ?? int.MaxValue)
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

        var googleRouteJson = JsonConvert.SerializeObject(run.GoogleRouteResponse);
        TblBulkRun? entity;

        if (!run.Id.HasValue || run.Id.Value == 0)
        {
            entity = new TblBulkRun
            {
                Name = run.Name,
                Mins = run.Mins,
                Kms = run.Kms,
                CourierId = run.Courier?.CourierId,
                Status = run.Status,
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
            entity.Status = run.Status;
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
        runToUpdate.Status = run.Status;
        runToUpdate.Revenue = run.Revenue;
        runToUpdate.Payout = run.Payout;
        runToUpdate.CourierPercentage = courierPercentage;
        runToUpdate.GoogleRouteResponse = JsonConvert.SerializeObject(run.GoogleRouteResponse);
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
        if (run == null) return ("Failed", "Run not found");

        var jobRuns = await Context.TblBulkJobRuns
            .Where(jr => jr.RunId == id)
            .ToListAsync();
        Context.TblBulkJobRuns.RemoveRange(jobRuns);
        Context.TblBulkRuns.Remove(run);
        await Context.SaveChangesAsync();

        Log.Information("Run {RunName} (id {RunId}) deleted with {JobCount} job links",
            run.Name, id, jobRuns.Count);
        return ("Success", "Deleted");
    }

    /// <summary>
    /// Move a job to a different run. Preserves the legacy optimistic-concurrency
    /// check on fromRunId so simultaneous moves by two operators can't overwrite
    /// each other silently.
    /// </summary>
    public async Task<(string Result, string Message)> UpdateJobToRunAsync(int jobId, int? fromRunId, int runId)
    {
        var existing = await Context.TblBulkJobRuns
            .FirstOrDefaultAsync(x => x.BulkJobId == jobId);

        if (fromRunId.HasValue && existing != null && existing.RunId != fromRunId.Value)
        {
            Log.Warning("UpdateJobToRun conflict: BulkJobId {JobId} expected on run {FromRunId} but is on {ActualRunId}",
                jobId, fromRunId, existing.RunId);
            return ("Failed", "Job has been moved by another user. Please refresh.");
        }

        if (existing != null)
        {
            if (existing.RunId != runId) existing.RunId = runId;
        }
        else
        {
            Context.TblBulkJobRuns.Add(new TblBulkJobRun { BulkJobId = jobId, RunId = runId });
        }

        // Denormalise onto tblBulkJob.BulkRunId so read-side filters
        // (GetBulkRunsAsync + GetBulkJobsAsync's runName join) see the change
        // immediately, without waiting for a lock/save round-trip. Legacy only
        // updated the join table here and deferred the denorm until Save-Run,
        // which surprised operators - keeping both in sync is safer.
        var jobRow = await Context.TblBulkJobs.FindAsync(jobId);
        if (jobRow != null) jobRow.BulkRunId = runId;

        await Context.SaveChangesAsync();
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
