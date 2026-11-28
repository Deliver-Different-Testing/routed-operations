// Unified Courier / Agent / NetworkPartner job-assignment service.
// Ports the legacy JobAgentAssignmentService verbatim so the frontend
// dialog contract (assignRouteDialogService) works end-to-end.
//
// Assign paths:
//   Courier -> uspRestoreJob when the job is on another courier (Cheetah R1),
//              then DES_stpJob_AutoDespatchSelectedJobs + DES_stpJob_AutoDespatchChildJobs.
//   Agent   -> EF ExecuteUpdateAsync (AgentId + status=105 + dispatch timestamps).
//   NP      -> EF ExecuteUpdateAsync (AgentId + NpAgentId + status=105 + timestamps).
//
// Unassign paths:
//   Courier -> uspRestoreJob per-job.
//   Agent   -> EF SetProperty (clear AgentId + status=0 + null dispatch dates).
//   NP      -> same as Agent + clear NpAgentId.
//
// Take(200) per bucket on the initial /assignable-targets read.
// LIKE-based typeahead search on /assignable-targets/couriers +
// /assignable-targets/agents. NP-scoped sessions get couriers only on
// the initial bucket read; agent searches short-circuit to empty.
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerAssignmentService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    INpScopeGuard scopeGuard,
    IBranchScopeGuard branchGuard,
    ILogger<RouteViewerAssignmentService> logger) : BaseService(contextFactory)
{
    private const int StatusUnassigned = 0;
    private const int StatusGroundAgentAssigned = 105;

    /// <summary>GET /api/runviewer/jobs/{jobId}/assignable-targets -
    /// initial 3-bucket picker load (Take 200 per bucket).</summary>
    public async Task<AssignableTargetsResponse> GetAssignableTargetsAsync(int jobId)
    {
        await scopeGuard.EnsureTucJobInScopeAsync(jobId);
        var scope = await scopeResolver.ResolveAsync();

        // NP-scoped: couriers-only bucket, agents + NPs empty.
        // Branches B2: branch-limited staff pick only couriers in their branches, applied in SQL before Take so the 200-row page is right.
        var couriers = await (await branchGuard.WhereCourierVisibleAsync(Context.TucCouriers
            .Where(c => c.Active)
            .Where(c => scope.IsAdmin || c.NpAgentId == scope.NpAgentId)))
            .OrderBy(c => c.UccrName)
            .Take(200)
            .Select(c => new AssignableTargetDto
            {
                Id = c.UccrId,
                Name = $"{c.UccrName} {c.UccrSurname}".Trim(),
                Hint = c.Code,
            })
            .ToListAsync();

        var response = new AssignableTargetsResponse { Couriers = couriers };
        if (!scope.IsAdmin) return response;

        response.Agents = await Context.TucAgents
            .Where(a => !a.IsNetworkPartner)
            .OrderBy(a => a.UcagName)
            .Take(200)
            .Select(a => new AssignableTargetDto
            {
                Id = a.UcagId,
                Name = a.UcagName,
                Hint = null,
            })
            .ToListAsync();

        response.Nps = await Context.TucAgents
            .Where(a => a.IsNetworkPartner)
            .OrderBy(a => a.UcagName)
            .Take(200)
            .Select(a => new AssignableTargetDto
            {
                Id = a.UcagId,
                Name = a.UcagName,
                Hint = null,
            })
            .ToListAsync();

        return response;
    }

    /// <summary>GET /api/runviewer/jobs/{jobId}/assignable-targets/couriers?q=&limit=
    /// - LIKE typeahead over name/surname/code.</summary>
    public async Task<List<AssignableTargetDto>> SearchCouriersAsync(int jobId, string? q, int limit)
    {
        await scopeGuard.EnsureTucJobInScopeAsync(jobId);
        var scope = await scopeResolver.ResolveAsync();

        var query = Context.TucCouriers.Where(c => c.Active);
        if (!scope.IsAdmin)
            query = query.Where(c => c.NpAgentId == scope.NpAgentId);
        query = await branchGuard.WhereCourierVisibleAsync(query);   // Branches B2

        if (!string.IsNullOrWhiteSpace(q))
        {
            var like = $"%{q}%";
            query = query.Where(c =>
                EF.Functions.Like(c.UccrName, like) ||
                EF.Functions.Like(c.UccrSurname, like) ||
                EF.Functions.Like(c.Code, like));
        }

        return await query
            .OrderBy(c => c.UccrName)
            .Take(Math.Clamp(limit, 1, 200))
            .Select(c => new AssignableTargetDto
            {
                Id = c.UccrId,
                Name = $"{c.UccrName} {c.UccrSurname}".Trim(),
                Hint = c.Code,
            })
            .ToListAsync();
    }

    /// <summary>GET /api/runviewer/jobs/{jobId}/assignable-targets/agents?q=&isNetworkPartner=&limit=
    /// - LIKE typeahead. NP-scoped -> empty (Section 1).</summary>
    public async Task<List<AssignableTargetDto>> SearchAgentsAsync(int jobId, string? q, bool isNetworkPartner, int limit)
    {
        await scopeGuard.EnsureTucJobInScopeAsync(jobId);
        var scope = await scopeResolver.ResolveAsync();
        if (!scope.IsAdmin) return new List<AssignableTargetDto>();

        var query = Context.TucAgents.Where(a => a.IsNetworkPartner == isNetworkPartner);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var like = $"%{q}%";
            query = query.Where(a => EF.Functions.Like(a.UcagName, like));
        }

        return await query
            .OrderBy(a => a.UcagName)
            .Take(Math.Clamp(limit, 1, 200))
            .Select(a => new AssignableTargetDto
            {
                Id = a.UcagId,
                Name = a.UcagName,
                Hint = null,
            })
            .ToListAsync();
    }

    /// <summary>POST /api/runviewer/jobs/assign - bulk assign; per-job
    /// guard then route to the per-target-type write path.</summary>
    public async Task<BulkAssignmentResult> AssignAsync(BulkAssignRequest request)
    {
        var result = new BulkAssignmentResult { TargetType = request.TargetType, TargetId = request.TargetId };

        foreach (var jobId in request.JobIds)
            await scopeGuard.EnsureTucJobInScopeAsync(jobId);

        switch (request.TargetType)
        {
            case "Courier":
                await MoveJobsToCourierAsync(request.JobIds, request.TargetId, result);
                break;

            case "Agent":
                // EF bulk update: AgentId + status=105 + dispatch stamps.
                // Include 1-level child jobs; deeper family reach is a
                // Section Z stakeholder call (Section 4.3 gap).
                var now = DateTime.UtcNow;
                var updatedAgent = await Context.TucJobs
                    .Where(j => request.JobIds.Contains(j.UcjbId)
                        || (j.ParentId != null && request.JobIds.Contains(j.ParentId.Value)))
                    .ExecuteUpdateAsync(u => u
                        .SetProperty(j => j.AgentId, request.TargetId)
                        .SetProperty(j => j.UcjbStatus, StatusGroundAgentAssigned)
                        .SetProperty(j => j.UcjbDispDate, (DateTime?)now.Date)
                        .SetProperty(j => j.UcjbDispTime, (DateTime?)now));
                result.Succeeded = updatedAgent;
                break;

            case "NetworkPartner":
                var agent = await Context.TucAgents
                    .FirstOrDefaultAsync(a => a.UcagId == request.TargetId && a.IsNetworkPartner);
                if (agent == null)
                {
                    result.Errors.Add($"Agent {request.TargetId} is not a Network Partner.");
                    result.Failed = request.JobIds.Count;
                    break;
                }
                var nowNp = DateTime.UtcNow;
                var updatedNp = await Context.TucJobs
                    .Where(j => request.JobIds.Contains(j.UcjbId)
                        || (j.ParentId != null && request.JobIds.Contains(j.ParentId.Value)))
                    .ExecuteUpdateAsync(u => u
                        .SetProperty(j => j.AgentId, (int?)request.TargetId)
                        .SetProperty(j => j.NpAgentId, (int?)request.TargetId)
                        .SetProperty(j => j.UcjbStatus, StatusGroundAgentAssigned)
                        .SetProperty(j => j.UcjbDispDate, (DateTime?)nowNp.Date)
                        .SetProperty(j => j.UcjbDispTime, (DateTime?)nowNp));
                result.Succeeded = updatedNp;
                break;

            default:
                result.Errors.Add($"Unknown TargetType '{request.TargetType}'.");
                result.Failed = request.JobIds.Count;
                break;
        }

        logger.LogInformation(
            "Assign {Target}={TargetId} to {N} job(s): {Ok} ok, {Moved} moved from another courier, {Rejected} rejected, {Fail} failed",
            request.TargetType, request.TargetId, request.JobIds.Count, result.Succeeded, result.Moved, result.Rejected.Count, result.Failed);
        return result;
    }

    /// <summary>Cheetah R1 (2026-11-28): the one courier (re)assign path.
    /// Per job, in request order:
    ///   completed (ucjbJobDone = 1 AND ucjbVoid = 0) -> rejected, untouched;
    ///   on a courier (another one OR the target, the same-courier resend) ->
    ///     uspRestoreJob FIRST (UTL_stpJob_RestoreDevice queues the void for the
    ///     phone and resets ucjbMobileSend), then despatch;
    ///   no courier -> despatch only.
    /// Despatch = DES_stpJob_AutoDespatchSelectedJobs + DES_stpJob_AutoDespatchChildJobs,
    /// the same pair RVW_stpTransferJob and DespatchWeb /job/ReAllocate run.
    /// Only the requested jobs are restored, as DespatchWeb RestoreJobsCoreAsync
    /// does: DES_stpJob_AutoDespatchChildJobs only sends sibling legs whose
    /// courier is NULL, so it never takes a leg off another courier.</summary>
    private async Task MoveJobsToCourierAsync(IReadOnlyList<int> jobIds, int targetCourierId, BulkAssignmentResult result)
    {
        var ids = jobIds.Distinct().ToList();
        var jobs = await Context.TucJobs
            .Where(j => ids.Contains(j.UcjbId))
            .Select(j => new { j.UcjbId, j.UcjbNumber, j.UcjbCourierId, j.UcjbJobDone, j.UcjbVoid })
            .ToDictionaryAsync(j => j.UcjbId);

        var courierIds = jobs.Values.Where(j => j.UcjbCourierId != null).Select(j => j.UcjbCourierId!.Value)
            .Append(targetCourierId).Distinct().ToList();
        var codes = await Context.TucCouriers
            .Where(c => courierIds.Contains(c.UccrId))
            .Select(c => new { c.UccrId, c.Code })
            .ToDictionaryAsync(c => c.UccrId, c => c.Code);
        string CodeOf(int id) => codes.TryGetValue(id, out var c) && !string.IsNullOrWhiteSpace(c) ? c.Trim() : $"#{id}";
        result.TargetCode = CodeOf(targetCourierId);

        foreach (var jobId in ids)
        {
            if (!jobs.TryGetValue(jobId, out var job))
            {
                result.Rejected.Add(new RejectedJobDto { JobId = jobId, Reason = "Job not found (it may have been archived)." });
                continue;
            }
            if (job.UcjbJobDone && !job.UcjbVoid)
            {
                result.Rejected.Add(new RejectedJobDto { JobId = jobId, JobNumber = job.UcjbNumber, Reason = "Job is already completed." });
                continue;
            }

            var restored = false;
            try
            {
                var fromOther = job.UcjbCourierId is { } from && from != targetCourierId;
                // Restore whenever the job has a courier, the target included:
                // re-assign to the same courier is the ops resend when the phone
                // missed the job. Despatch alone leaves ucjbMobileSend = 1, and the
                // Mars send gate (MARS_stpJobMessages_UpdateSent) only picks up
                // ucjbMobileSend = 0; uspRestoreJob is what resets it.
                if (job.UcjbCourierId != null)
                {
                    await RestoreJobAsync(jobId);
                    restored = true;
                }

                // A POD can land between the read above and here; uspRestoreJob
                // self-guards but the despatch does not (20260511134131).
                if (await Context.TucJobs.AnyAsync(j => j.UcjbId == jobId && j.UcjbJobDone && !j.UcjbVoid))
                {
                    result.Rejected.Add(new RejectedJobDto { JobId = jobId, JobNumber = job.UcjbNumber, Reason = "Job was completed while it was being moved." });
                    continue;
                }

                await DespatchJobToCourierAsync(jobId, targetCourierId);
                result.Succeeded++;
                if (fromOther)
                {
                    result.Moved++;
                    var fromCode = CodeOf(job.UcjbCourierId!.Value);
                    if (!result.FromCourierCodes.Contains(fromCode)) result.FromCourierCodes.Add(fromCode);
                }
            }
            catch (Exception ex)
            {
                result.Failed++;
                result.Errors.Add($"Job {job.UcjbNumber ?? jobId.ToString()}: {ex.Message}");
                // No transaction spans restore + despatch (review F3/S2): a job
                // restored and then not despatched is on nobody's phone, so the
                // toast must name it and say it needs assigning again.
                result.FailedJobs.Add(new FailedJobDto
                {
                    JobId = jobId,
                    JobNumber = job.UcjbNumber,
                    NowUnassigned = restored || job.UcjbCourierId == null,
                });
            }
        }
    }

    /// <summary>uspRestoreJob: voids the job on the current courier's phone
    /// (UTL_stpJob_RestoreDevice) and clears the courier. Self-guards completed
    /// jobs. Virtual so tests can record the call order.</summary>
    protected virtual Task RestoreJobAsync(int jobId) =>
        Context.Database.ExecuteSqlRawAsync("EXEC dbo.uspRestoreJob @intJobID", SpParam.Of("@intJobID", jobId));

    /// <summary>Despatch one job (and its courier-less auto-despatch sibling
    /// legs) to a courier. Virtual so tests can record the call order.</summary>
    protected virtual async Task DespatchJobToCourierAsync(int jobId, int courierId)
    {
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.DES_stpJob_AutoDespatchSelectedJobs @JobID, @CourierID",
            SpParam.Of("@JobID", jobId),
            SpParam.Of("@CourierID", courierId));
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.DES_stpJob_AutoDespatchChildJobs @JobID, @InternalStatus",
            SpParam.Of("@JobID", jobId),
            SpParam.Of("@InternalStatus", 3));
    }

    /// <summary>POST /api/runviewer/jobs/unassign - per-target-type
    /// unassign. Courier via uspRestoreJob SP; Agent + NP via EF bulk
    /// update to status=0 + null dispatch dates.</summary>
    public async Task<BulkAssignmentResult> UnassignAsync(BulkUnassignRequest request)
    {
        var result = new BulkAssignmentResult { TargetType = request.Target };

        foreach (var jobId in request.JobIds)
            await scopeGuard.EnsureTucJobInScopeAsync(jobId);

        switch (request.Target)
        {
            case "Courier":
                foreach (var jobId in request.JobIds)
                {
                    try
                    {
                        await RestoreJobAsync(jobId);
                        result.Succeeded++;
                    }
                    catch (Exception ex)
                    {
                        result.Failed++;
                        result.Errors.Add($"Job {jobId}: {ex.Message}");
                    }
                }
                break;

            case "Agent":
                var updatedAgent = await Context.TucJobs
                    .Where(j => request.JobIds.Contains(j.UcjbId))
                    .ExecuteUpdateAsync(u => u
                        .SetProperty(j => j.AgentId, (int?)null)
                        .SetProperty(j => j.UcjbStatus, StatusUnassigned)
                        .SetProperty(j => j.UcjbDispDate, (DateTime?)null)
                        .SetProperty(j => j.UcjbDispTime, (DateTime?)null));
                result.Succeeded = updatedAgent;
                break;

            case "NetworkPartner":
                var updatedNp = await Context.TucJobs
                    .Where(j => request.JobIds.Contains(j.UcjbId))
                    .ExecuteUpdateAsync(u => u
                        .SetProperty(j => j.AgentId, (int?)null)
                        .SetProperty(j => j.NpAgentId, (int?)null)
                        .SetProperty(j => j.UcjbStatus, StatusUnassigned)
                        .SetProperty(j => j.UcjbDispDate, (DateTime?)null)
                        .SetProperty(j => j.UcjbDispTime, (DateTime?)null));
                result.Succeeded = updatedNp;
                break;

            default:
                result.Errors.Add($"Unknown target '{request.Target}'.");
                result.Failed = request.JobIds.Count;
                break;
        }

        return result;
    }

    /// <summary>Cheetah R2 (contract v2, migration 20261128100500): the four
    /// run procs take an optional last @RunDate and, for a CAPS route run
    /// (RunId = -RouteId), collect that route's jobs for the date themselves
    /// (dbo.RVW_fncRouteRunJobIDs) and then do exactly what they do for a
    /// tblBulkRun run: restore before re-assigning, skip completed jobs,
    /// pre-assign = status 18, transfer = despatch, release = status 0.
    /// @RunDate is sent ONLY for a route run, so a real run's call sends the
    /// same parameters as before (now by name, which the procs accept) and
    /// still works against a tenant that has not had the migration yet.
    /// The procs RAISERROR (50000) on an unknown courier or a route run with
    /// no date; that is a request problem, not a server fault.</summary>
    private async Task ExecRunProcAsync(string proc, int runId, DateTime? runDate, params (string Name, object? Value)[] args)
    {
        var (sql, parameters) = RunProcCall(proc, runId, runDate, args);
        try
        {
            await Context.Database.ExecuteSqlRawAsync(sql, parameters);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 50000)
        {
            logger.LogWarning(ex, "{Proc} rejected by proc: {Message}", proc, ex.Message);
            throw new RunCourierRejectedException(ex.Message);
        }
    }

    private static (string Sql, object[] Parameters) RunProcCall(string proc, int runId, DateTime? runDate, (string Name, object? Value)[] args)
    {
        if (runId < 0 && runDate == null)
            throw new RunCourierRejectedException("Pick a run date first.");
        var parameters = new List<(string Name, object? Value)> { ("@RunID", runId) };
        parameters.AddRange(args);
        if (runId < 0)
            parameters.Add(("@RunDate", runDate!.Value.Date));
        var sql = $"EXEC dbo.{proc} " + string.Join(", ", parameters.Select(p => $"{p.Name} = {p.Name}"));
        return (sql, parameters.Select(p => (object)SpParam.Of(p.Name, p.Value)).ToArray());
    }

    /// <summary>Fix round 1 F1 (Kevin, 2026-11-28, option A): on a CAPS route
    /// run (RunId &lt; 0) Pre-assign, Re-assign and dropping a courier on the
    /// run all mean "move it to this driver now". RVW_stpTransferRun restores
    /// each job off the old courier (never a completed one) and despatches it
    /// to the new one. Its route branch returns one outcome row per job
    /// (20261128100500); they are mapped onto the same result the job Assign
    /// path fills, so the toast reads the same ("Moved 3 jobs from 512 to 1.").</summary>
    private async Task<BulkAssignmentResult> TransferRouteRunAsync(int runId, string? fromCourierCode, string toCourierCode, DateTime? runDate)
    {
        var from = string.IsNullOrWhiteSpace(fromCourierCode) ? null : fromCourierCode.Trim();
        var (sql, parameters) = RunProcCall("RVW_stpTransferRun", runId, runDate,
            [("@FromCourierCode", from), ("@ToCourierCode", toCourierCode)]);
        List<RouteRunOutcomeRow> rows;
        try
        {
            rows = await QueryRouteRunOutcomesAsync(sql, parameters);
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 50000)
        {
            logger.LogWarning(ex, "RVW_stpTransferRun rejected by proc: {Message}", ex.Message);
            throw new RunCourierRejectedException(ex.Message);
        }

        var result = new BulkAssignmentResult { TargetType = "Courier", TargetCode = toCourierCode };
        // Same-courier re-assign (the resend): the proc restores and despatches
        // back to the same driver and reports "Moved"; count it as a plain
        // success so the toast reads "Assigned 3 jobs to 220", not "Moved from 220 to 220".
        var resend = from != null && string.Equals(from, toCourierCode?.Trim(), StringComparison.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            switch (row.Outcome)
            {
                case "Moved" when resend:
                    result.Succeeded++;
                    break;
                case "Moved":
                    result.Succeeded++;
                    result.Moved++;
                    break;
                case "Assigned":
                case "Voided": // transfer to the void code 800
                    result.Succeeded++;
                    break;
                case "Skipped":
                    result.Rejected.Add(new RejectedJobDto { JobId = row.JobID, JobNumber = row.JobNumber, Reason = "Job is already completed." });
                    break;
                default:
                    result.Failed++;
                    result.FailedJobs.Add(new FailedJobDto { JobId = row.JobID, JobNumber = row.JobNumber, NowUnassigned = row.NowUnassigned });
                    break;
            }
        }
        if (result.Moved > 0 && from != null) result.FromCourierCodes.Add(from);
        logger.LogInformation(
            "Route run {RunId} to {To}: {Ok} ok, {Moved} moved from {From}, {Skipped} skipped, {Fail} failed",
            runId, toCourierCode, result.Succeeded, result.Moved, from, result.Rejected.Count, result.Failed);
        return result;
    }

    /// <summary>Runs the route-run transfer and reads its outcome rows.</summary>
    protected virtual Task<List<RouteRunOutcomeRow>> QueryRouteRunOutcomesAsync(string sql, object[] parameters) =>
        Context.Database.SqlQueryRaw<RouteRunOutcomeRow>(sql, parameters).ToListAsync();

    /// <summary>POST /api/runviewer/jobs/preassign-run - pre-assign an
    /// entire run to a courier (or re-assign from one courier to
    /// another). Wraps legacy RVW_stpPreAssignRun so the drag-drop
    /// flow can hit a single SP instead of iterating jobIds through
    /// the courier-per-job path. runDate is required when runId &lt; 0.
    /// A route run (runId &lt; 0) goes to TransferRouteRunAsync instead and
    /// returns what happened per job; a real run returns null (status 18,
    /// no despatch, unchanged).</summary>
    public async Task<BulkAssignmentResult?> PreAssignRunAsync(int runId, string? fromCourierCode, string toCourierCode, DateTime? runDate = null)
    {
        // Branches B2: a run-level write needs the whole run to be the caller's (its courier, or every job). No-op unless branch limited.
        await branchGuard.EnsureRunInScopeAsync(runId);
        if (runId < 0)
        {
            // Re-assign to the driver the run is already on is the ops "resend"
            // path (the phone missed the job): the transfer restores every job
            // (void on the phone) and despatches it again, same as any re-assign.
            return await TransferRouteRunAsync(runId, fromCourierCode, toCourierCode, runDate);
        }
        // #816: the proc RAISERRORs on an unknown / inactive courier code
        // before writing anything (surfaced as RunCourierRejectedException).
        await ExecRunProcAsync("RVW_stpPreAssignRun", runId, runDate,
            ("@FromCourierCode", string.IsNullOrEmpty(fromCourierCode) ? null : fromCourierCode),
            ("@ToCourierCode", toCourierCode));
        return null;
    }

    /// <summary>POST /api/runviewer/jobs/unassign-run - release a whole
    /// run from a courier. Wraps legacy RVW_stpUnAssignRun.</summary>
    public async Task UnAssignRunAsync(int runId, string courierCode, DateTime? runDate = null)
    {
        // Branches B2: a run-level write needs the whole run to be the caller's (its courier, or every job). No-op unless branch limited.
        await branchGuard.EnsureRunInScopeAsync(runId);
        await ExecRunProcAsync("RVW_stpUnAssignRun", runId, runDate, ("@CourierCode", courierCode));
    }

    /// <summary>POST /api/runviewer/jobs/transfer-run - bulk-transfer
    /// every job on a run from one courier to another. Wraps legacy
    /// RVW_stpTransferRun. Different from `PreAssignRunAsync` in that
    /// the latter is a soft pre-assign while this actually moves the
    /// jobs off the source courier.</summary>
    public async Task TransferRunAsync(int runId, string fromCourierCode, string toCourierCode, DateTime? runDate = null)
    {
        // Branches B2: a run-level write needs the whole run to be the caller's (its courier, or every job). No-op unless branch limited.
        await branchGuard.EnsureRunInScopeAsync(runId);
        await ExecRunProcAsync("RVW_stpTransferRun", runId, runDate,
            ("@FromCourierCode", fromCourierCode ?? string.Empty),
            ("@ToCourierCode", toCourierCode ?? string.Empty));
    }

    /// <summary>POST /api/runviewer/jobs/release-run - "Release To Courier":
    /// the run's pre-assigned jobs (status 18) go to status 0 and keep their
    /// courier, so MARS_stpJobMessages_UpdateSent sends them to that
    /// driver's phone. No restore. Wraps legacy RVW_stpReleaseRun.</summary>
    public async Task ReleaseRunAsync(int runId, string courierCode, DateTime? runDate = null)
    {
        // Branches B2: a run-level write needs the whole run to be the caller's (its courier, or every job). No-op unless branch limited.
        await branchGuard.EnsureRunInScopeAsync(runId);
        await ExecRunProcAsync("RVW_stpReleaseRun", runId, runDate, ("@CourierCode", courierCode));
    }

    /// <summary>POST /api/runviewer/jobs/transfer-original-run-order -
    /// reassign the run's ORIGINAL owner (the courier who first held it
    /// before any subsequent TransferRun / ReleaseRun / UnAssignRun
    /// swaps). Separate from TransferRunAsync because that moves the
    /// current jobs; this rewrites who "owns" the run for reporting +
    /// courier-percentage rollups. Wraps legacy RVW_stpTransferOriginalRunOrder.</summary>
    public async Task TransferOriginalRunOrderAsync(int runId, string toCourierCode)
    {
        // Cheetah R2: a route run has no tblBulkRun row to keep the order on.
        if (runId < 0)
            throw new RunCourierRejectedException("Original run order is not kept for route runs.");
        // Branches B2: a run-level write needs the whole run to be the caller's (its courier, or every job). No-op unless branch limited.
        await branchGuard.EnsureRunInScopeAsync(runId);
        await Context.Database.ExecuteSqlRawAsync(
            "EXEC dbo.RVW_stpTransferOriginalRunOrder @RunID, @ToCourierCode",
            SpParam.Of("@RunID", runId),
            SpParam.Of("@ToCourierCode", toCourierCode ?? string.Empty));
    }
}

/// <summary>#816: RVW_stpPreAssignRun / RVW_stpUnAssignRun refused the
/// courier code (RAISERROR 50000). Nothing was written.</summary>
public sealed class RunCourierRejectedException(string message) : Exception(message);
