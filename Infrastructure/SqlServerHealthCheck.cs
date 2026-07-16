using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Serilog;

namespace RoutedOperations.Infrastructure;

public class SqlServerHealthCheck : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        var connectionString = Environment.GetEnvironmentVariable("SQLHealthCheckConnection");
        if (string.IsNullOrEmpty(connectionString))
        {
            // Don't crash the readiness probe if the env var is missing - return
            // Unhealthy so the pod stays out of the LB rotation until it's set.
            Log.Warning("SQLHealthCheckConnection env var is not set - SQL health check reporting Unhealthy");
            return HealthCheckResult.Unhealthy("SQLHealthCheckConnection env var is not set");
        }

        try
        {
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync(cancellationToken);

            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT @@version";
            var version = await command.ExecuteScalarAsync(cancellationToken) as string;

            Log.Debug("SQL Server health check succeeded");
            return HealthCheckResult.Healthy($"Connected. Version: {version}");
        }
        catch (Exception ex)
        {
            Log.Error(ex, "SQL Server health check failed");
            return HealthCheckResult.Unhealthy(ex.Message);
        }
    }
}
