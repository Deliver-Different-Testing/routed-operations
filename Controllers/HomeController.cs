using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Infrastructure;
using Serilog;
using RoutedOperations.Core.Application.Utilities;

namespace RoutedOperations.Controllers;

public record AppUserBootstrap(
    int? CurrentTenantId,
    string? FullName,
    string? Email,
    string? TimeZone,
    string? CountryCode,
    bool IsUsTenant,
    bool IsInternal,
    string? HereMapsApiKey,
    string? GoogleMapsKey,
    // Route Viewer P0 additions (2026-08-07). All optional - existing modules
    // (Route Builder, Auto-Assign, Polygons, Scheduled Routes, BulkImport) do
    // not read them. NP-scope guard + CS event visibility + client filter
    // dropdowns downstream consume these.
    bool IsNetworkPartner,
    int? NpAgentId,
    string? ClientTypeId,
    int? ContactId,
    int? ClientId,
    int? ClientCount,
    string? ClientString,
    // Per-tenant DespatchWeb base URL (from the DespatchWebBaseUrl env var).
    // Powers the Recurring Routes page's "Recurring Jobs" external link + the
    // "Open ↗" schedule deep-links inside the Linehaul edit modal.
    // Empty/null hides both. Mirrors the Configurator AppUserBootstrap shape.
    string? DespatchWebBaseUrl);

/// <summary>
/// SPA fallback + tenant claim enrichment. Also seeds the tenant Despatch
/// connection string into the Redis cache so the very first API call after
/// login can resolve its DbContext without extra round-trips.
/// </summary>
[Authorize]
public class HomeController(
    IConnectionStringManager connectionStringManager,
    AppSettings appSettings) : Controller
{
    public async Task<IActionResult> Index()
    {
        // If someone lands here via /api/* the fallback shouldn't render the SPA - return 404 so
        // downstream fetch consumers see a real failure instead of HTML.
        if (HttpContext.Request.Path.StartsWithSegments("/api"))
            return NotFound();

        var connectionString = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "Connection")?.Value;
        var tenantId = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "CurrentTenantID")?.Value;
        var timeZone = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "TimeZone")?.Value;
        var countryCode = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "CountryCode")?.Value;
        var email = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == ClaimTypes.Email)?.Value;

        // Hub stamps "FirstName" + "Surname" as separate claims (see hub
        // AccountController.cs:473-474). Prefer those for the Dashboard
        // "You" card; fall back to Identity.Name (which is the email) only
        // when both name claims are missing.
        var firstName = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "FirstName")?.Value;
        var surname = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "Surname")?.Value;
        var identityName = HttpContext.User.Identity?.Name;
        var composedName = string.Join(" ", new[] { firstName, surname }
            .Where(s => !string.IsNullOrWhiteSpace(s)));
        var fullName = !string.IsNullOrWhiteSpace(composedName)
            ? composedName
            : identityName;

        Log.Information(
            "HomeController.Index - TenantId: {TenantId}, TimeZone: {TimeZone}, Country: {Country}, HasConnection: {HasConn}",
            tenantId ?? "null", timeZone ?? "null", countryCode ?? "null", !string.IsNullOrEmpty(connectionString));

        if (string.IsNullOrEmpty(connectionString) || string.IsNullOrEmpty(tenantId))
        {
            Log.Error("Connection string or tenant id missing - redirecting to login");
            return Redirect(Environment.GetEnvironmentVariable("PublicPath") ?? "https://deliverdifferent.com/");
        }

        var credentials = Environment.GetEnvironmentVariable("SQLCredentials");
        if (string.IsNullOrEmpty(credentials))
            throw new InvalidOperationException("Env var 'SQLCredentials' is not set.");

        await connectionStringManager.SetConnectionStringAsync(
            TenantConnectionCache.Key(tenantId),
            connectionString + credentials);

        // Hub's shared cookie only carries Identity.Name (which is the login
        // email). ClaimTypes.Email isn't stamped, so fall back to Identity.Name
        // for the email field to avoid the "Email: Unknown" cosmetic bug in
        // the Dashboard's "You" card.
        var resolvedEmail = !string.IsNullOrEmpty(email)
            ? email
            : (identityName?.Contains('@') == true ? identityName : null);

        // "Internal" claim is stamped by Hub for internal-staff logins - we
        // read the boolean form and default false. Wired through here so the
        // React SPA can gate the Staff Import affordance (NZ internal only)
        // without a second round-trip to fetch it.
        var internalClaim = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "Internal")?.Value;
        var isInternal = !string.IsNullOrEmpty(internalClaim)
            && bool.TryParse(internalClaim, out var internalValue)
            && internalValue;

        // Route Viewer P0 - stamp NP-scope + client-scope claims onto the
        // bootstrap. All optional; NP-scope guard + CS module downstream
        // consume via useAuth() in the React app. Legacy RunViewer stamped
        // these via Razor globals; Route Viewer flows them through the same
        // AppUserBootstrap the rest of the SPA already uses.
        var isNetworkPartnerClaim = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "IsNetworkPartner")?.Value;
        var isNetworkPartner = !string.IsNullOrEmpty(isNetworkPartnerClaim)
            && bool.TryParse(isNetworkPartnerClaim, out var npFlag)
            && npFlag;
        var npAgentIdClaim = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "NpAgentId")?.Value;
        var npAgentId = int.TryParse(npAgentIdClaim, out var npId) ? npId : (int?)null;
        var clientTypeId = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "ClientTypeId")?.Value;
        var contactIdClaim = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "ContactID")?.Value;
        var contactId = int.TryParse(contactIdClaim, out var cid) ? cid : (int?)null;
        var clientIdClaim = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "ClientID")?.Value;
        var clientId = int.TryParse(clientIdClaim, out var clid) ? clid : (int?)null;
        var clientCountClaim = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "ClientCount")?.Value;
        var clientCount = int.TryParse(clientCountClaim, out var cc) ? cc : (int?)null;
        var clientString = HttpContext.User.Claims
            .FirstOrDefault(x => x.Type == "ClientString")?.Value;

        var bootstrap = new AppUserBootstrap(
            CurrentTenantId: int.TryParse(tenantId, out var tid) ? tid : null,
            FullName: fullName,
            Email: resolvedEmail,
            TimeZone: timeZone,
            CountryCode: countryCode,
            IsUsTenant: string.Equals(countryCode, "US", StringComparison.OrdinalIgnoreCase),
            IsInternal: isInternal,
            HereMapsApiKey: appSettings.HereMapsApiKey,
            GoogleMapsKey: appSettings.GoogleMapsKey,
            IsNetworkPartner: isNetworkPartner,
            NpAgentId: npAgentId,
            ClientTypeId: clientTypeId,
            ContactId: contactId,
            ClientId: clientId,
            ClientCount: clientCount,
            ClientString: clientString,
            DespatchWebBaseUrl: string.IsNullOrEmpty(appSettings.DespatchWebBaseUrl) ? null : appSettings.DespatchWebBaseUrl);

        return View(bootstrap);
    }

    [AllowAnonymous]
    [HttpGet("/Forbidden")]
    public IActionResult Forbidden() => View();
}
