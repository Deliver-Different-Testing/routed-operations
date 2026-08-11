// Customer Service event DTOs. Sourced from RVW_stpEvents (event list)
// and RVW_stpEventJobs (job typeahead in the create-event dialog).
//
// T.1 SECURITY: RVW_stpEvents has NO NpAgentId scope + tblBulkEvent
// has NO NpAgentId column. NP users would see cross-tenant events.
// The Route Viewer EventService short-circuits to empty for NP scope
// as the interim fix pending the backfill decision (Section Z).

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class EventDto
{
    public int BulkEventId { get; set; }
    public int? BulkJobId { get; set; }
    public int? ClientId { get; set; }
    public int? CourierId { get; set; }
    public string? JobNumber { get; set; }
    public string? CourierCode { get; set; }

    public string? Notes { get; set; }
    public bool Internal { get; set; }
    public bool ClientCreated { get; set; }
    public bool ClientFollowup { get; set; }

    public string? CreatedByName { get; set; }
    public DateOnly EventDate { get; set; }
    public DateTime Created { get; set; }

    public DateTime? ClosedDate { get; set; }
    public string? ClosedByName { get; set; }
}

public class EventJobDto
{
    public int BulkJobId { get; set; }
    public string? JobNumber { get; set; }
    public string? ClientCode { get; set; }
    public string? ToAddress { get; set; }
    public string? CourierCode { get; set; }
    public int? CourierId { get; set; }
}

public class DirectLinkResponse
{
    /// <summary>Signed URL for external clients. "Link Declined" for
    /// internal clients (they use the app directly).</summary>
    public string? Url { get; set; }
}

public class EventListRequest
{
    public DateTime? RunDate { get; set; }
    public int? ClientId { get; set; }
    public bool ClientInternal { get; set; }
    public bool IncludeClosed { get; set; }
}

/// <summary>Payload for POST /api/runviewer/events. Mirrors legacy
/// BookController.CreateEventAsync signature; email dispatch on
/// Notify is deferred until tenant notification transport is
/// wired.</summary>
public class CreateEventRequest
{
    public int? BulkJobId { get; set; }
    public int? CourierId { get; set; }
    public string? Notes { get; set; }
    public string? Name { get; set; }
    public bool Internal { get; set; }
    public bool ClientFollowup { get; set; }
    public bool ClientCreated { get; set; }
    public DateTime EventDate { get; set; }
    public int? ClientId { get; set; }
    public bool Notify { get; set; }
    public string? ClientName { get; set; }
}

/// <summary>Payload for POST /api/runviewer/events/{id}/close. The
/// closedBy string carries the operator's display name (already
/// prefixed with tenant/client on the frontend so it renders in the
/// Closed By column verbatim).</summary>
public class CloseEventRequest
{
    public string? ClosedBy { get; set; }
}

/// <summary>Payload for POST /api/runviewer/events/{id}/reply.</summary>
public class AddEventReplyRequest
{
    public string Note { get; set; } = string.Empty;
    public string? UserName { get; set; }
}

/// <summary>Payload for POST /api/runviewer/jobs/client-intel.
/// Metadata-only interim; file upload to S3 lands with the CS
/// module upload flow.</summary>
public class ClientIntelRequest
{
    public string Mobile { get; set; } = string.Empty;
    public bool Dog { get; set; }
    public bool HasPhoto { get; set; }
    public string? Notes { get; set; }
    public string? PhotoDescription { get; set; }
    public bool IsNew { get; set; } = true;
}
