// Unified Courier / Agent / NetworkPartner job-assignment service.
// Ports the legacy JobAgentAssignmentService verbatim so the frontend
// dialog contract (assignRouteDialogService) works end-to-end.
//
// Assign paths:
//   Courier -> DES_stpJob_AutoDespatchSelectedJobs + DES_stpJob_AutoDespatchChildJobs.
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
using RoutedOperations.Core.Application.Services;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerAssignmentService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    INpScopeResolver scopeResolver,
    INpScopeGuard scopeGuard,
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
        var couriers = await Context.TucCouriers
            .Where(c => c.Active)
            .Where(c => scope.IsAdmin || c.NpAgentId == scope.NpAgentId)
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
                foreach (var jobId in request.JobIds)
                {
                    try
                    {
                        await Context.Database.ExecuteSqlRawAsync(
                            "EXEC dbo.DES_stpJob_AutoDespatchSelectedJobs @JobID, @CourierID",
                            SpParam.Of("@JobID", jobId),
                            SpParam.Of("@CourierID", request.TargetId));
                        await Context.Database.ExecuteSqlRawAsync(
                            "EXEC dbo.DES_stpJob_AutoDespatchChildJobs @JobID, @InternalStatus",
                            SpParam.Of("@JobID", jobId),
                            SpParam.Of("@InternalStatus", 3));
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
            "Assign {Target}={TargetId} to {N} job(s): {Ok} ok, {Fail} failed",
            request.TargetType, request.TargetId, request.JobIds.Count, result.Succeeded, result.Failed);
        return result;
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
                        await Context.Database.ExecuteSqlRawAsync(
                            "EXEC dbo.uspRestoreJob @intJobID",
                            SpParam.Of("@intJobID", jobId));
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
}
