namespace RoutedOperations.Infrastructure;

/// <summary>
/// Strongly-typed application settings populated at startup from configuration
/// sources (environment variables, appsettings.json). Registered as a singleton
/// so any service can inject it. Mirrors the Configurator pattern for stack
/// consistency.
/// </summary>
public class AppSettings
{
    /// <summary>
    /// RouteSavvy optimizer application id. Read from env var `RouteSavyID`
    /// (note the legacy spelling - kept as-is so existing tenant configs keep
    /// working). Empty value disables the optimize endpoint - the
    /// RouteOptimizationService throws a clear error until it is configured.
    /// </summary>
    public string RouteSavvyAppId { get; set; } = string.Empty;

    /// <summary>
    /// HERE Maps API key used by the server-side findsequence2 proxy for the
    /// Delivery Window build mode. Bound from env var `HeremapApiKey`. Kept
    /// server-side only - never exposed to the SPA.
    /// </summary>
    public string HereMapsApiKey { get; set; } = string.Empty;

    /// <summary>
    /// Google Maps JavaScript API key used by the cockpit map component. Bound
    /// from env var `GoogleMapsKey` (matches legacy RunBuilder). Surfaced to the
    /// SPA via HomeController's AuthConfig payload. Empty value renders a
    /// diagnostic placeholder instead of the map.
    /// </summary>
    public string GoogleMapsKey { get; set; } = string.Empty;

    /// <summary>
    /// Development-only Google Maps JS API key, bound from env var
    /// `GoogleMapsDevKey`. Used by developer machines that cannot use the
    /// billed production key (referrer restriction or unbilled localhost).
    /// Program.cs prefers this when set AND ASPNETCORE_ENVIRONMENT is
    /// Development; falls back to GoogleMapsKey otherwise.
    /// </summary>
    public string GoogleMapsDevKey { get; set; } = string.Empty;

    /// <summary>
    /// Base URL of the tenant's DespatchWeb (Dispatch software) app
    /// (`https://despatch.{tenant}.{env}.deliverdifferent.com`), no trailing
    /// slash. Set per-tenant deployment via env var DespatchWebBaseUrl.
    /// Surfaced to the SPA in the bootstrap blob so the Recurring Routes page
    /// can deep-link to DespatchWeb's Recurring Jobs view + so the "Open ↗"
    /// links inside the Linehaul edit modal's Used-by-Schedules list resolve.
    /// Empty value hides the "Recurring Jobs" tab + those Open ↗ links.
    /// Mirrors Configurator's AppSettings.DespatchWebBaseUrl for stack
    /// consistency.
    /// </summary>
    public string DespatchWebBaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// SSRS (SQL Server Reporting Services) base URL, e.g.
    /// `https://reporting.deliverdifferent.com/ReportServer`. Bound from env
    /// var `ReportBase`. Consumed by the Route Viewer P11 Report module
    /// (RunAllocation / MissingScan / WoopRunNumber). Empty value returns 501
    /// with a "set ReportBase" diagnostic.
    /// </summary>
    public string ReportBase { get; set; } = string.Empty;

    /// <summary>NTLM username for SSRS. Bound from env var `ReportUsername`.</summary>
    public string ReportUsername { get; set; } = string.Empty;

    /// <summary>NTLM password for SSRS. Bound from env var `ReportPassword`.</summary>
    public string ReportPassword { get; set; } = string.Empty;

    /// <summary>NTLM Windows domain for SSRS. Bound from env var `ReportDomain`.</summary>
    public string ReportDomain { get; set; } = string.Empty;

    /// <summary>
    /// Path to the SSL certificate file used to validate the SSRS TLS chain
    /// when SSRS is hosted on a private CA. Bound from env var
    /// `SSL_CERTIFICATE`. Empty value uses the default system trust store.
    /// </summary>
    public string SslCertificate { get; set; } = string.Empty;
}
