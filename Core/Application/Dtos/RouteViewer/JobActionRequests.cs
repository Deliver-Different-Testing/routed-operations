// Request DTOs for Route Viewer job-action endpoints. Each action wraps
// a single RVW_stp* mutation SP - see RouteViewerJobActionService for
// the SP mapping. Kept in one file since each DTO is 1-3 properties.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

/// <summary>Single-job action targeting tucJob.ucjbID (the LIVE job
/// id). Most mutation SPs key off ucjbID, not BulkJobID.</summary>
public class JobActionRequest
{
    public int JobId { get; set; }
}

/// <summary>Bulk action targeting one or more tblBulkJob.BulkJobID.
/// Used by Cancel / MoveToRunBuilder which walk the family
/// internally.</summary>
public class BulkJobActionRequest
{
    public int[] BulkJobIds { get; set; } = Array.Empty<int>();
}

public class CompleteJobRequest
{
    public int JobId { get; set; }
    public string PodName { get; set; } = string.Empty;
    /// <summary>Optional. Defaults to server "now" when null.</summary>
    public DateTime? CompletedTime { get; set; }
}

public class LmcJobRequest
{
    public int JobId { get; set; }
    public int BulkJobId { get; set; }
    /// <summary>Courier code the job was ORIGINALLY assigned to
    /// (the LMC-generating courier). SP records this for the audit
    /// trail on the parent job.</summary>
    public string FromCourierCode { get; set; } = string.Empty;
}

public class TransferJobRequest
{
    public int JobId { get; set; }
    public string FromCourierCode { get; set; } = string.Empty;
    public string ToCourierCode { get; set; } = string.Empty;
}

public class SendSmsRequest
{
    public int JobId { get; set; }
    /// <summary>Destination mobile - typically the job's recipient
    /// (tucJob.ProofOfDeliveryMobile). Frontend can pre-fill from the
    /// currentJob and let the operator edit before send.</summary>
    public string Mobile { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}

/// <summary>Broadcast SMS to every driver on a run. Wraps legacy
/// RVW_stpMessageRun; user name is resolved from claims server-side
/// for the SP's audit column.</summary>
public class SendSmsRunRequest
{
    public int RunId { get; set; }
    public string Message { get; set; } = string.Empty;
}

public class MoveJobsBackToRunBuilderRequest
{
    public int[] BulkJobIds { get; set; } = Array.Empty<int>();
    /// <summary>New book-time (bookdate + booktime combined) for the
    /// moved jobs. SP re-stamps ucjbDate + ucjbTime on the target
    /// tucJob rows.</summary>
    public DateTime NewDateTime { get; set; }
    /// <summary>Target ucjbSpeed (tucJobType.ucjtID).</summary>
    public int NewSpeed { get; set; }
    /// <summary>When true, void the original job(s) after move (a
    /// "keep" checkbox in the legacy UI toggles this).</summary>
    public bool Void { get; set; }
}

public class AddJobNoteRequest
{
    public int JobId { get; set; }
    public string Notes { get; set; } = string.Empty;
}

public class AddBulkJobNoteRequest
{
    public int BulkJobId { get; set; }
    public string Notes { get; set; } = string.Empty;
}

/// <summary>GPS-update payload for a single job's pickup or delivery
/// address. Backend routes to RVW_stpUpdateBulkJobPickupAddress
/// or ...DeliveryAddress depending on `leg`. Address lines 1-8 are
/// optional (SP accepts NULL / empty for the parsed sub-fields when
/// the caller only has the flat address + suburb + postcode).</summary>
public class UpdateJobGpsRequest
{
    public int BulkJobId { get; set; }
    /// <summary>"pickup" or "delivery" - selects which SP fires.</summary>
    public string Leg { get; set; } = "delivery";
    public string Address { get; set; } = string.Empty;
    public string Suburb { get; set; } = string.Empty;
    public int? PostCode { get; set; }
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    /// <summary>Optional structured address lines 1-8 (parsed from
    /// Google Places / HERE geocode). Legacy leaves them empty when
    /// the operator only edits lat/lng on the map. Pass an empty
    /// array to leave the SP inputs blank.</summary>
    public string[] AddressLines { get; set; } = Array.Empty<string>();
}

/// <summary>Partial-update for the editable text fields exposed on the
/// Route Viewer Detail pane. Every property is optional - unset means
/// "leave alone" (server loads the current value from tblBulkJob and
/// passes it through so the SP round-trip doesn't clobber unmentioned
/// fields).</summary>
public class UpdateJobTextFieldsRequest
{
    public string? ToAddress { get; set; }
    public string? ToSuburb { get; set; }
    public short? Quantity { get; set; }
    public string? Notes { get; set; }
    public string? RefA { get; set; }
    public string? RefB { get; set; }
    public string? OurRef { get; set; }
}
