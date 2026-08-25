using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using RoutedOperations.Infrastructure;
using Serilog;
using RoutedOperations.Core.Application.Utilities;

namespace RoutedOperations.Core.Application.Services.Job;

/// <summary>
/// Thin Dapper wrapper around `UTL_stpJob_tblBulkJob_SyncHDJobs`. Deferred to a
/// later phase per STEVE-ROUTEBUILDER-V2-PARITY-LIFT-PLAN-KEVIN-2026-06-20.md;
/// leaving the SP body untouched keeps EH/HD-copy behaviour identical while the
/// EF Core lift is designed.
/// </summary>
public class HdJobSyncService(
    IConnectionStringManager connectionStringManager,
    IHttpContextAccessor httpContextAccessor)
{
    public async Task<(string Result, string? Message)> SyncAsync(DateTime runDate)
    {
        var connectionString = await ResolveTenantConnectionAsync();
        try
        {
            await using var conn = new SqlConnection(connectionString);
            await conn.ExecuteAsync(
                "UTL_stpJob_tblBulkJob_SyncHDJobs",
                new { BookDate = runDate },
                commandType: System.Data.CommandType.StoredProcedure);
            return ("Success", null);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "HdJobSyncService failed for {RunDate}", runDate);
            return ("Failed", ex.InnerException?.Message ?? ex.Message);
        }
    }

    private async Task<string> ResolveTenantConnectionAsync()
    {
        var tenantId = httpContextAccessor.HttpContext?.User.Claims
            .FirstOrDefault(x => x.Type == "CurrentTenantID")?.Value;
        if (string.IsNullOrEmpty(tenantId))
            throw new InvalidOperationException(
                "HdJobSyncService called without CurrentTenantID - request is not authenticated to a tenant.");

        var cacheKey = TenantConnectionCache.Key(tenantId);
        var connectionString = await connectionStringManager.GetConnectionStringAsync(cacheKey);
        if (string.IsNullOrEmpty(connectionString))
            // Transitional: sessions seeded under the old shared key.
            connectionString = await connectionStringManager
                .GetConnectionStringAsync(TenantConnectionCache.LegacyKey(tenantId));
        if (string.IsNullOrEmpty(connectionString))
            throw new InvalidOperationException(
                $"HdJobSyncService could not resolve connection string for tenant {tenantId}.");
        return TenantConnectionCache.ApplyOwnCredentials(connectionString);
    }
}
