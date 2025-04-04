using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace RunBuilder
{
    public class SqlServerHealthCheck(IConfiguration configuration, ILogger<SqlServerHealthCheck> logger)
        : IHealthCheck
    {
        private readonly string _healthCheckConnectionString = 
            Environment.GetEnvironmentVariable("SQLHealthCheckConnection")
            ?? throw new InvalidOperationException("SQLHealthCheckConnection environment variable is not set.");


        public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
        {
            try
            {
                await using var connection = new SqlConnection(_healthCheckConnectionString);
                await connection.OpenAsync(cancellationToken);

                // Perform a simple query to check database responsiveness
                await using var command = connection.CreateCommand();
                command.CommandText = "SELECT @@version";
                var version = await command.ExecuteScalarAsync(cancellationToken) as string;

                logger.LogInformation("SQL Server health check succeeded");
                return HealthCheckResult.Healthy($"Successfully connected to SQL Server. Version: {version}");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "SQL Server health check failed");
                return HealthCheckResult.Unhealthy(ex.Message);
            }
        }
    }
}
