using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Lightweight session-echo endpoint used by the React AuthContext to detect
/// cross-tenant drift. The SPA reads the initial `CurrentTenantID` claim from
/// the server-rendered `window.__APP_USER__` bootstrap; that value is captured
/// once at page load. When a user switches tenants on the hub, the shared
/// auth cookie updates but the SPA's in-memory bootstrap does not. Overview
/// / Run data comes from tenant-scoped API calls that use the fresh cookie -
/// so Overview shows the new tenant, but per-tenant caches (React Query
/// lookup responses, localStorage filter selections) keep serving the old
/// tenant's data until the tab is reloaded.
///
/// This endpoint returns the current cookie's tenant id + email with no DB
/// touch. AuthContext polls it on window-focus and, when the returned id
/// diverges from the bootstrap, purges the stale caches and hard-reloads
/// the tab so every downstream surface re-hydrates against the new tenant.
/// </summary>
[ApiController]
[Route("api/session")]
[Authorize]
public class SessionController : ControllerBase
{
    /// <summary>GET /api/session/current - returns the current authenticated
    /// user's tenant id + email from the request cookie's claims. Callers use
    /// this to detect tenant drift after a hub tenant-switch.</summary>
    [HttpGet("current")]
    public IActionResult GetCurrent()
    {
        var tenantIdClaim = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "CurrentTenantID")?.Value;
        var email = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == ClaimTypes.Email)?.Value;
        var identityName = HttpContext.User.Identity?.Name;
        var resolvedEmail = !string.IsNullOrEmpty(email)
            ? email
            : (identityName?.Contains('@') == true ? identityName : null);

        return Ok(new
        {
            currentTenantId = int.TryParse(tenantIdClaim, out var tid) ? tid : (int?)null,
            email = resolvedEmail,
        });
    }
}
