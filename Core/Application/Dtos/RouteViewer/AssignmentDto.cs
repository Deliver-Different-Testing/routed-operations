// DTOs for the unified 3-way Assign Route + Unassign endpoints.
// Consumed by the frontend assignRouteDialogService (P6 dialog); backend
// endpoints ship in P1 so the dialog can wire against real routes.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class AssignableTargetsResponse
{
    public List<AssignableTargetDto> Couriers { get; set; } = new();
    public List<AssignableTargetDto> Agents { get; set; } = new();
    public List<AssignableTargetDto> Nps { get; set; } = new();
}

public class AssignableTargetDto
{
    public int Id { get; set; }
    public string? Name { get; set; }
    /// <summary>Courier: code / Agent: AddressLine6 area / NP: same.</summary>
    public string? Hint { get; set; }
}

public class BulkAssignRequest
{
    public List<int> JobIds { get; set; } = new();
    /// <summary>"Courier" | "Agent" | "NetworkPartner".</summary>
    public string TargetType { get; set; } = "Courier";
    public int TargetId { get; set; }
}

public class BulkUnassignRequest
{
    public List<int> JobIds { get; set; } = new();
    /// <summary>"Courier" | "Agent" | "NetworkPartner".</summary>
    public string Target { get; set; } = "Courier";
}

/// <summary>Payload for POST /api/runviewer/jobs/preassign-run.
/// Drag-drop entry point; one SP call covers the whole run. A normal run
/// goes to RVW_stpPreAssignRun, a route run (RunId &lt; 0) to
/// RVW_stpTransferRun.</summary>
public class PreAssignRunRequest
{
    public int RunId { get; set; }
    public string? FromCourierCode { get; set; }
    public string ToCourierCode { get; set; } = string.Empty;
    /// <summary>Route Viewer date. Required when RunId &lt; 0 (CAPS route
    /// run, RunId = -RouteId): the route's jobs are resolved per date.</summary>
    public DateTime? RunDate { get; set; }
}

/// <summary>Payload for POST /api/runviewer/jobs/transfer-run.
/// Wraps RVW_stpTransferRun.</summary>
public class TransferRunRequest
{
    public int RunId { get; set; }
    public string? FromCourierCode { get; set; }
    public string ToCourierCode { get; set; } = string.Empty;
    /// <summary>Required when RunId &lt; 0, see PreAssignRunRequest.</summary>
    public DateTime? RunDate { get; set; }
}

/// <summary>Payload for POST /api/runviewer/jobs/release-run.</summary>
public class ReleaseRunRequest
{
    public int RunId { get; set; }
    public string CourierCode { get; set; } = string.Empty;
    /// <summary>Required when RunId &lt; 0, see PreAssignRunRequest.</summary>
    public DateTime? RunDate { get; set; }
}

/// <summary>Payload for POST /api/runviewer/jobs/unassign-run.</summary>
public class UnAssignRunRequest
{
    public int RunId { get; set; }
    public string CourierCode { get; set; } = string.Empty;
    /// <summary>Required when RunId &lt; 0, see PreAssignRunRequest.</summary>
    public DateTime? RunDate { get; set; }
}

/// <summary>Payload for POST /api/runviewer/jobs/transfer-original-run-order.
/// Reassigns a run's original owner. Wraps RVW_stpTransferOriginalRunOrder.</summary>
public class TransferOriginalRunOrderRequest
{
    public int RunId { get; set; }
    public string ToCourierCode { get; set; } = string.Empty;
}

public class BulkAssignmentResult
{
    public int Succeeded { get; set; }
    public int Failed { get; set; }
    public List<string> Errors { get; set; } = new();
    public string? TargetType { get; set; }
    public int? TargetId { get; set; }
    public string? DisplayName { get; set; }

    // Cheetah R1 (2026-11-28): what a courier assign actually did, for the
    // "Moved 3 jobs from 22 to 2" toast. Filled by the Courier path only.
    /// <summary>Jobs taken off another courier (restored, then despatched).</summary>
    public int Moved { get; set; }
    /// <summary>Distinct codes of the couriers the moved jobs came from.</summary>
    public List<string> FromCourierCodes { get; set; } = new();
    /// <summary>Code of the courier the jobs went to.</summary>
    public string? TargetCode { get; set; }
    /// <summary>Jobs left untouched on purpose (completed, not found).</summary>
    public List<RejectedJobDto> Rejected { get; set; } = new();
    /// <summary>Jobs that failed, named so the toast can say which ones are
    /// now on nobody's phone and need assigning again.</summary>
    public List<FailedJobDto> FailedJobs { get; set; } = new();
}

public class FailedJobDto
{
    public int JobId { get; set; }
    public string? JobNumber { get; set; }
    /// <summary>True when the job has no courier after the failure (it was
    /// restored off the old courier, or never had one).</summary>
    public bool NowUnassigned { get; set; }
}

/// <summary>One row of RVW_stpTransferRun's route-run result set
/// (20261128100500). Outcome: Moved, Assigned, Skipped or Failed.</summary>
public class RouteRunOutcomeRow
{
    public int JobID { get; set; }
    public string? JobNumber { get; set; }
    public string Outcome { get; set; } = string.Empty;
    public bool NowUnassigned { get; set; }
}

public class RejectedJobDto
{
    public int JobId { get; set; }
    public string? JobNumber { get; set; }
    public string Reason { get; set; } = string.Empty;
}
