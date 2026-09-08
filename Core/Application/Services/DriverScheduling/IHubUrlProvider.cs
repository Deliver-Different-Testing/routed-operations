namespace RoutedOperations.Core.Application.Services.DriverScheduling;

/// <summary>
/// Per-tenant driver-portal URL provider. CourierManager's legacy
/// scheduler baked `https://hub.urgent.deliverdifferent.com` into five
/// SMS templates - NZ-Urgent-only. For Day-1 US live the URL needs to
/// resolve per-tenant so a US-Medical operator's scheduler SMS points
/// at the medical hub, not the NZ Urgent one.
///
/// Contract: returns the fully-qualified hub URL (trailing slash
/// preserved when present in the source) or null if no hub is
/// configured for the current tenant. Callers must handle the null
/// case by omitting the link from the SMS body rather than sending a
/// broken URL.
/// </summary>
public interface IHubUrlProvider
{
    /// <summary>The driver-portal URL for the current tenant, or null
    /// if none is configured. Reads the current auth claims + tenant
    /// configuration.</summary>
    string? GetHubUrl();
}
