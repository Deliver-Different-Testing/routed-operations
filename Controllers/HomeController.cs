using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Infrastructure;
using Serilog;

namespace RoutedOperations.Controllers;

public record AppUserBootstrap(
    int? CurrentTenantId,
    string? FullName,
    string? Email,
    string? TimeZone,
    string? CountryCode,
    bool IsUsTenant,
    string? HereMapsApiKey,
    string? GoogleMapsKey);

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
        var fullName = HttpContext.User.Identity?.Name;

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
            $"{tenantId}-ClientManager-Connection",
            connectionString + credentials);

        // Hub's shared cookie only carries Identity.Name (which is the login
        // email). ClaimTypes.Email isn't stamped, so fall back to Identity.Name
        // for the email field to avoid the "Email: Unknown" cosmetic bug in
        // the Dashboard's "You" card.
        var resolvedEmail = !string.IsNullOrEmpty(email)
            ? email
            : (fullName?.Contains('@') == true ? fullName : null);

        var bootstrap = new AppUserBootstrap(
            CurrentTenantId: int.TryParse(tenantId, out var tid) ? tid : null,
            FullName: fullName,
            Email: resolvedEmail,
            TimeZone: timeZone,
            CountryCode: countryCode,
            IsUsTenant: string.Equals(countryCode, "US", StringComparison.OrdinalIgnoreCase),
            HereMapsApiKey: appSettings.HereMapsApiKey,
            GoogleMapsKey: appSettings.GoogleMapsKey);

        return View(bootstrap);
    }

    [AllowAnonymous]
    [HttpGet("/Forbidden")]
    public IActionResult Forbidden() => View();
}
