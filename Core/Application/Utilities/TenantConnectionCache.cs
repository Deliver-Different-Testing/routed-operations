using Microsoft.Data.SqlClient;
using Serilog;

namespace RoutedOperations.Core.Application.Utilities;

/// <summary>
/// Owns the per-tenant connection-string cache key, and guarantees the resulting
/// connection uses THIS application's SQL credentials.
///
/// Background: routed-operations, despatchweb, clientmanager and
/// dfrntdrive_configurator all used to read *and write* a single shared cache entry
/// ("{tenantId}-ClientManager-Connection") in the same Redis instance, each
/// appending its own SQLCredentials. Whichever app a user opened last therefore
/// decided which SQL login every other app connected as. On 2026-08-25 that
/// surfaced on Despatch-Medical-Prod as despatchweb running under the
/// ClientManager login and being denied EXECUTE on a prebook procedure.
///
/// Each app now owns its own key. <see cref="LegacyKey"/> is a transitional read
/// fallback so sessions already cached under the shared key keep working during
/// the rollout, and <see cref="ApplyOwnCredentials"/> makes that fallback safe by
/// re-stamping our credentials over whatever the entry carries. The fallback is
/// removed once every app and tenant has been deployed.
/// </summary>
public static class TenantConnectionCache
{
    private const string AppName = "RoutedOperations";

    /// <summary>This application's own cache key for a tenant.</summary>
    public static string Key(string? tenantId) => $"{tenantId}-{AppName}-Connection";

    /// <summary>The shared key used before each app owned its own. Read-only, transitional.</summary>
    public static string LegacyKey(string? tenantId) => $"{tenantId}-ClientManager-Connection";

    /// <summary>
    /// Re-stamps this application's SQLCredentials over whatever credentials the
    /// cached connection string carries. A no-op when they already match.
    /// </summary>
    public static string ApplyOwnCredentials(string connectionString) =>
        ApplyOwnCredentials(connectionString, Environment.GetEnvironmentVariable("SQLCredentials"));

    /// <summary>Overload taking the credentials explicitly, for testing.</summary>
    public static string ApplyOwnCredentials(string connectionString, string? credentials)
    {
        if (string.IsNullOrWhiteSpace(connectionString) || string.IsNullOrWhiteSpace(credentials))
        {
            return connectionString;
        }

        try
        {
            var builder = new SqlConnectionStringBuilder(connectionString);

            // SqlConnectionStringBuilder drops content it cannot parse rather than
            // throwing, so rewriting an unrecognisable value would silently lose the
            // server and database. Leave anything without a server alone.
            if (string.IsNullOrEmpty(builder.DataSource))
            {
                Log.Warning("Cached connection string has no server; leaving credentials untouched");
                return connectionString;
            }

            var ours = new SqlConnectionStringBuilder(credentials);

            // Assigning through the builder normalises the uid/UID/User ID and
            // pwd/Password synonyms the various apps use in their env vars.
            if (!string.IsNullOrEmpty(ours.UserID))
            {
                builder.UserID = ours.UserID;
            }

            if (!string.IsNullOrEmpty(ours.Password))
            {
                builder.Password = ours.Password;
            }

            // Keep the SqlClient pool warm across requests. Default MinPoolSize
            // is 0, so idle connections are trimmed within a minute and the
            // next request re-pays the SSL/auth handshake (~500-1000ms per
            // connection to AWS RDS over WAN). A modest MinPoolSize means
            // parallel read queries (ScheduleService.ListSummaryAsync fires
            // up to 9 concurrent) usually land on warm sockets.
            //
            // 2026-09-17 audit HIGH #7: previously 20. On a many-tenant
            // deployment (200 tenants across 3 app instances) that pinned
            // 12k idle sessions per host. Bumped down to 5 so the ratio
            // stays sane; hot tenants earn more via ambient traffic
            // keeping the pool warm above the floor. Explicit env override
            // (SQLCredentials with Min Pool Size=N) still wins.
            if (builder.MinPoolSize < 5)
            {
                builder.MinPoolSize = 5;
            }

            return builder.ConnectionString;
        }
        catch (ArgumentException ex)
        {
            Log.Warning(ex, "Could not re-stamp SQL credentials onto the cached connection string");
            return connectionString;
        }
    }
}
