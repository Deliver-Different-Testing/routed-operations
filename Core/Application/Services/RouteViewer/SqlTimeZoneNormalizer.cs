// Windows/IANA tenant timezone normaliser for the @TenantTimeZone SP
// parameter that RVW_stpBulkRuns_2 added on 2026-06-24 as part of
// Track C Option B. SQL Server on Windows accepts only Windows TZ names
// ("Pacific Standard Time"); SQL Server on Linux accepts only IANA
// ("America/Los_Angeles"). The tenant claim carries whichever form was
// stamped by Hub, which is inconsistent across tenants.
//
// Legacy RunViewer probed sys.servername once per connection and cached
// the host platform (see RunRepository.GetIsLinuxSqlHost). Here we mirror
// that pattern - a single probe on first use for the app-lifetime host
// (target-side SQL host does not change mid-process), then a small
// static map for the Windows <-> IANA conversion.
//
// Falls back to passing the tenant tz value verbatim (SP accepts NULL /
// unknown and reverts to server-local time) when the map has no entry.
// P0 wire this in via the RouteViewer service that calls RVW_stpBulkRuns_2;
// per-connection host caching lives inside RouteViewerRunService for now,
// promoted to a scoped singleton if a second consumer emerges.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class SqlTimeZoneNormalizer(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
{
    private static bool? _isLinuxSqlHost;
    private static readonly object _probeLock = new();

    // Windows TZ id -> IANA. Extend as new tenants come online.
    // Names harvested from the RunViewer legacy WINDOWS_TO_IANA map +
    // the Windows registry standard. Add more entries if a tenant's
    // TimeZone claim contains a Windows id not listed here.
    private static readonly Dictionary<string, string> WindowsToIana = new(StringComparer.OrdinalIgnoreCase)
    {
        ["New Zealand Standard Time"] = "Pacific/Auckland",
        ["AUS Eastern Standard Time"] = "Australia/Sydney",
        ["Pacific Standard Time"]     = "America/Los_Angeles",
        ["Mountain Standard Time"]    = "America/Denver",
        ["Central Standard Time"]     = "America/Chicago",
        ["Eastern Standard Time"]     = "America/New_York",
        ["UTC"]                       = "Etc/UTC",
    };

    private static readonly Dictionary<string, string> IanaToWindows =
        WindowsToIana.ToDictionary(kv => kv.Value, kv => kv.Key, StringComparer.OrdinalIgnoreCase);

    public async Task<string?> NormalizeAsync(string? tenantTimeZone)
    {
        if (string.IsNullOrWhiteSpace(tenantTimeZone)) return null;

        var isLinux = await GetIsLinuxSqlHostAsync();

        if (isLinux)
        {
            // SQL host is Linux - needs IANA. If we got a Windows id,
            // convert; if we got IANA already, pass through.
            return WindowsToIana.TryGetValue(tenantTimeZone, out var iana) ? iana : tenantTimeZone;
        }

        // SQL host is Windows - needs Windows id. Convert IANA if needed.
        return IanaToWindows.TryGetValue(tenantTimeZone, out var win) ? win : tenantTimeZone;
    }

    private async Task<bool> GetIsLinuxSqlHostAsync()
    {
        if (_isLinuxSqlHost.HasValue) return _isLinuxSqlHost.Value;

        // Single probe; race-safe under the lock.
        await using var context = await contextFactory.CreateDbContextAsync();
        var host = await context.Database.SqlQueryRaw<string>(
            "SELECT CAST(SERVERPROPERTY('HostPlatform') AS nvarchar(32)) AS Value")
            .FirstOrDefaultAsync();

        lock (_probeLock)
        {
            _isLinuxSqlHost ??= string.Equals(host, "Linux", StringComparison.OrdinalIgnoreCase);
        }
        return _isLinuxSqlHost.Value;
    }
}
