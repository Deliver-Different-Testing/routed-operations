// Query filter for GET /api/runviewer/runs/{runId}/jobs. Fetches jobs
// belonging to a single run - drives the inner runBuilder grid on Home.
//
// CRITICAL: runDate MUST be passed EVEN for positive runIds. The SP
// raises RAISERROR when @RunID < 0 AND @RunDate IS NULL (synthetic Route
// Run safeguard captured in docs/RecurringRoute/CLAUDE-RULES.md).
// Client-side service must never omit runDate; the DTO makes it
// required (nullable at the type level for query binding, but the
// service validates + throws if missing).

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class BulkRunJobsRequest
{
    /// <summary>Book date. REQUIRED even for positive runIds - SP raises
    /// on missing date when RunID is synthetic (< 0).</summary>
    public DateTime? RunDate { get; set; }

    public int? ClientId { get; set; }
    public bool ClientInternal { get; set; }
    public bool MultipleClients { get; set; }
    public int? CourierId { get; set; }
    public bool PreAssigned { get; set; }
    public string? SpeedIds { get; set; }
    public string? ClientIds { get; set; }
    public string? RegionIds { get; set; }
}
