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
    /// HERE Maps API key used by the server-side findsequence2 proxy and
    /// surfaced to the SPA for map-tile rendering. Bound from env var
    /// `HeremapApiKey`. Empty value disables the HERE proxy and hides the
    /// map from the cockpit.
    /// </summary>
    public string HereMapsApiKey { get; set; } = string.Empty;
}
