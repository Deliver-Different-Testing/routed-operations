using System.Security.Claims;
using Microsoft.AspNetCore.Http;

namespace RoutedOperations.Core.Application.Services.DriverScheduling;

/// <summary>
/// Resolves the tenant's driver hub URL from the auth-claim
/// `DriverHubUrl` (populated by HomeController when the Hub cookie
/// carries it). Falls back to the DRIVER_HUB_URL environment variable
/// so ops can override per-deploy without touching the Hub.
///
/// Registered scoped in Program.cs. Kevin's Day-1 requirement: verify
/// a hub URL exists for every production US tenant before merge; if
/// null the SMS body must omit the link rather than send a broken
/// one. DriverSchedulingService checks for null and drops the "See
/// your schedule at ..." line accordingly.
/// </summary>
public class HubUrlProvider(IHttpContextAccessor httpContextAccessor) : IHubUrlProvider
{
    public string? GetHubUrl()
    {
        var claimUrl = httpContextAccessor.HttpContext?.User
            .FindFirstValue("DriverHubUrl");
        if (!string.IsNullOrWhiteSpace(claimUrl)) return claimUrl;

        // Env fallback for dev + ops override. Empty env var falls
        // through to null so the SMS body knows to omit the link.
        var envUrl = Environment.GetEnvironmentVariable("DRIVER_HUB_URL");
        return string.IsNullOrWhiteSpace(envUrl) ? null : envUrl;
    }
}
