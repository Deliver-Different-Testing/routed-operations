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
/// Drag-drop entry point; wraps RVW_stpPreAssignRun (single SP call
/// covers the whole run in one round-trip).</summary>
public class PreAssignRunRequest
{
    public int RunId { get; set; }
    public string? FromCourierCode { get; set; }
    public string ToCourierCode { get; set; } = string.Empty;
}

/// <summary>Payload for POST /api/runviewer/jobs/transfer-run.
/// Wraps RVW_stpTransferRun.</summary>
public class TransferRunRequest
{
    public int RunId { get; set; }
    public string? FromCourierCode { get; set; }
    public string ToCourierCode { get; set; } = string.Empty;
}

/// <summary>Payload for POST /api/runviewer/jobs/release-run.</summary>
public class ReleaseRunRequest
{
    public int RunId { get; set; }
    public string CourierCode { get; set; } = string.Empty;
}

/// <summary>Payload for POST /api/runviewer/jobs/unassign-run.</summary>
public class UnAssignRunRequest
{
    public int RunId { get; set; }
    public string CourierCode { get; set; } = string.Empty;
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
}
