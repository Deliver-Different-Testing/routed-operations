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
}
