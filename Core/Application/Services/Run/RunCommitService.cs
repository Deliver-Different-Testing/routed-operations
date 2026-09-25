using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Infrastructure;
using Serilog;
using RoutedOperations.Core.Application.Utilities;

namespace RoutedOperations.Core.Application.Services.Run;

/// <summary>
/// Dispatch (send-to-live). Wraps the legacy stored procedure
/// `UTL_stpJob_InsertFromRunBuilder`, which recursively drives
/// `UTL_stpJob_InsertFromTblBulkJob` to copy tblBulkJob rows into tucJob.
///
/// The SP body is intentionally NOT rewritten in Stage 1 - it does a huge
/// amount of work (multibox recursion, NWDoc/Wellington/LMC special cases,
/// prebook branch, sibling pointer fixups, ~140 column mapping, MERGE + HOLDLOCK
/// anchor-run logic). Rewriting it in EF Core is a Phase-2 exercise
/// (see docs/STEVE-ROUTEBUILDER-V2-PARITY-LIFT-PLAN-KEVIN-2026-06-20.md).
///
/// For now this service is a thin Dapper wrapper. Every job in every locked run
/// is dispatched via one SP call.
/// </summary>
public class RunCommitService(
    IConnectionStringManager connectionStringManager,
    IHttpContextAccessor httpContextAccessor)
{
    public async Task<List<DispatchResult>> DispatchAsync(IEnumerable<InsertOrUpdateRunRequest> runs)
    {
        var results = new List<DispatchResult>();
        var connectionString = await ResolveTenantConnectionAsync();

        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync();

        foreach (var run in runs)
        {
            var runName = run.Name;
            float courierPercentage = 0;
            if (!string.IsNullOrEmpty(run.CourierPercent))
            {
                courierPercentage = float.Parse(
                    run.CourierPercent.TrimEnd('%', ' '),
                    CultureInfo.InvariantCulture) / 100f;
            }

            var courierId = run.Courier?.CourierId;
            var runOrder = 1;

            foreach (var job in run.Jobs)
            {
                try
                {
                    await conn.ExecuteAsync(
                        "UTL_stpJob_InsertFromRunBuilder",
                        new
                        {
                            BulkJobID = job.BulkJobId,
                            CourierID = courierId,
                            RunName = runName,
                            RunOrder = runOrder++,
                            CourierPercentage = courierPercentage,
                            RunStatus = run.Status
                        },
                        commandType: System.Data.CommandType.StoredProcedure);

                    results.Add(new DispatchResult { Result = "Success" });
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Dispatch failed for BulkJobId {JobId} in run {RunName}",
                        job.BulkJobId, runName);
                    results.Add(new DispatchResult
                    {
                        Result = "Failed",
                        Message = ex.InnerException?.Message ?? ex.Message
                    });
                }
            }
        }

        return results;
    }

    /// <summary>
    /// Send-selected variant of DispatchAsync. Wraps the same SP but takes a
    /// flat list of bulk job ids instead of a runs collection. Each job gets
    /// its own SP call so partial success is preserved (one bad job doesn't
    /// stop the rest). Legacy analogue: sendSelectedJobsToLive.
    /// </summary>
    public async Task<List<DispatchResult>> DispatchJobsAsync(DispatchJobsRequest request)
    {
        var results = new List<DispatchResult>();
        var connectionString = await ResolveTenantConnectionAsync();

        var runName = request.RunName ?? "Selected Jobs";
        float courierPercentage = 0;
        if (!string.IsNullOrEmpty(request.CourierPercent))
        {
            courierPercentage = float.Parse(
                request.CourierPercent.TrimEnd('%', ' '),
                System.Globalization.CultureInfo.InvariantCulture) / 100f;
        }

        await using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync();

        var runOrder = 1;
        foreach (var jobId in request.JobIds)
        {
            try
            {
                await conn.ExecuteAsync(
                    "UTL_stpJob_InsertFromRunBuilder",
                    new
                    {
                        BulkJobID = jobId,
                        CourierID = request.CourierId,
                        RunName = runName,
                        RunOrder = runOrder++,
                        CourierPercentage = courierPercentage,
                        RunStatus = request.Status,
                    },
                    commandType: System.Data.CommandType.StoredProcedure);
                results.Add(new DispatchResult { Result = "Success" });
            }
            catch (Exception ex)
            {
                Log.Error(ex, "DispatchJobsAsync failed for BulkJobId {JobId}", jobId);
                results.Add(new DispatchResult
                {
                    Result = "Failed",
                    Message = ex.InnerException?.Message ?? ex.Message,
                });
            }
        }

        return results;
    }

    private async Task<string> ResolveTenantConnectionAsync()
    {
        var tenantId = httpContextAccessor.HttpContext?.User.Claims
            .FirstOrDefault(x => x.Type == "CurrentTenantID")?.Value;
        if (string.IsNullOrEmpty(tenantId))
            throw new InvalidOperationException(
                "RunCommitService called without CurrentTenantID - request is not authenticated to a tenant.");

        var cacheKey = TenantConnectionCache.Key(tenantId);
        var connectionString = await connectionStringManager.GetConnectionStringAsync(cacheKey);
        if (string.IsNullOrEmpty(connectionString))
            // Transitional: sessions seeded under the old shared key.
            connectionString = await connectionStringManager
                .GetConnectionStringAsync(TenantConnectionCache.LegacyKey(tenantId));
        if (string.IsNullOrEmpty(connectionString))
            throw new InvalidOperationException(
                $"RunCommitService could not resolve connection string for tenant {tenantId}.");
        return TenantConnectionCache.ApplyOwnCredentials(connectionString);
    }
}
