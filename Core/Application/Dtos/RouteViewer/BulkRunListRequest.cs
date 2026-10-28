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

    // ClientInternal / MultipleClients were removed 2026-10-09. Nothing on
    // the server read them, but they invited exactly that: scope must come
    // from claims (INpScopeResolver), never from the request. Older clients
    // still send them and model binding ignores the unknown keys.

    /// <summary>Single-client convenience filter; usually null for
    /// admin sessions and stamped by claim for external logins.</summary>
    public int? ClientId { get; set; }

    /// <summary>Comma-separated int list. Empty string / null = no
    /// filter. IN-clause parameter, not SQL-injectable.</summary>
    public string? ClientIds { get; set; }

    public string? RegionIds { get; set; }

    public string? SpeedIds { get; set; }

    /// <summary>Direction filter (Combined / Inbound / Outbound), bound from
    /// the query string. The Run Viewer frontend sends it on /runs,
    /// /runs/{id}/jobs and /runs/overview.
    ///
    /// Since Feature 5.4 this IS read server-side, but only here on the run
    /// LIST: it goes to RVW_stpBulkRuns_2's @Group, which filters synthetic
    /// route runs by Routes.Direction. NULL and 'Combined' are no-ops.
    ///
    /// The other two endpoints still ignore it, deliberately. Job-level
    /// direction filtering already happens on the client in
    /// runViewerViewMode.ts, so a second server-side copy would be two
    /// places to keep in sync for no behaviour change.
    ///
    /// Still true and still worth heeding: RVW_stpBulkRunJobs and
    /// RVW_stpBulkJobSearchData do NOT declare a @Group parameter. Do not
    /// wire it into either without checking that SP's signature first - a
    /// previous attempt passed it to RVW_stpBulkJobSearchData positionally
    /// and broke the call outright.</summary>
    public string? Group { get; set; }
}
