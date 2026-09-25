// Query filter for GET /api/runviewer/runs. Every field is nullable /
// empty-string tolerant so the SP's IN-clause branches degrade to
// "no filter" when the caller omits a param. Empty strings coerce to
// DBNull inside the SP wrapper per legacy behaviour.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class BulkRunListRequest
{
    /// <summary>Book-date filter. Required. Uses the tenant's local date
    /// resolved via tenantTodayYmd() on the client.</summary>
    public DateTime? RunDate { get; set; }

    /// <summary>true when the caller's Hub client is marked internal
    /// (tenant staff / UCL ops). Drives SP branches that unlock the
    /// full client scope. NP + external logins pass false.</summary>
    public bool ClientInternal { get; set; }

    /// <summary>true when the Hub session has multiple sub-accounts
    /// (external multi-account client). Drives the SP's multi-client
    /// SELECT branch.</summary>
    public bool MultipleClients { get; set; }

    /// <summary>Single-client convenience filter; usually null for
    /// admin sessions and stamped by claim for external logins.</summary>
    public int? ClientId { get; set; }

    /// <summary>Comma-separated int list. Empty string / null = no
    /// filter. IN-clause parameter, not SQL-injectable.</summary>
    public string? ClientIds { get; set; }

    public string? RegionIds { get; set; }

    public string? SpeedIds { get; set; }

    /// <summary>Legacy group-by filter (Combined / Inbound / Outbound).
    /// Passed verbatim to the SP - values are the legacy strings.</summary>
    public string? Group { get; set; }
}
