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

public class BulkAssignmentResult
{
    public int Succeeded { get; set; }
    public int Failed { get; set; }
    public List<string> Errors { get; set; } = new();
    public string? TargetType { get; set; }
    public int? TargetId { get; set; }
    public string? DisplayName { get; set; }
}
