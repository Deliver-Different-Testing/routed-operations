namespace RoutedOperations.Core.Application.Dtos.Route;

public class SavvyLocationDto
{
    public string? Name { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public int VisitDurationInMinutes { get; set; }
}

public class OptimizeParameters
{
    public string? AppId { get; set; }
    public string? OptimizeType { get; set; }
    public string? RouteType { get; set; }
    public string? Avoid { get; set; }
    public string? Departure { get; set; }
}

public class RouteSavvyRequest
{
    public List<SavvyLocationDto> Locations { get; set; } = new();
    public OptimizeParameters OptimizeParameters { get; set; } = new();
}

public class RouteSavvyResponse
{
    public string? Message { get; set; }
    public List<OptimizedStop> OptimizedStops { get; set; } = new();
}

public class OptimizedStop
{
    public string? Name { get; set; }
    public int Index { get; set; }
    public RouteLocation RouteLocation { get; set; } = new();
}

public class RouteLocation
{
    public double Latitude { get; set; }
    public double Longitude { get; set; }
}

public class HereMapSequenceRequest
{
    // Wire name is `requestData` (camelCase resolver handles the case swap on
    // both directions). Property stays PascalCase to match C# convention.
    public string RequestData { get; set; } = string.Empty;
}

public class LatLngDto
{
    public double Lat { get; set; }
    public double Lng { get; set; }
    public string? Name { get; set; }
}

/// <summary>
/// Typed HERE findsequence2 request. Server builds the full query string
/// (start + destinations + mode + apiKey) so the frontend never sees the key.
/// Used by the Delivery Window build flow to get real per-leg travel minutes.
/// </summary>
public class HereSequenceRequestTyped
{
    public HereSequenceStop Start { get; set; } = new();
    public List<HereSequenceStop> Destinations { get; set; } = new();
    /// <summary>
    /// HERE routing mode. Default `fastest;car;traffic:disabled` matches the
    /// legacy RunBuilder default; operators can override per-request later.
    /// </summary>
    public string Mode { get; set; } = "fastest;car;traffic:disabled";
    /// <summary>
    /// If true, append the Start point as the final `end` waypoint - a circuit
    /// route (Plan §Phase 2 §6.2 A-A mode). HERE treats a fixed `end` as an
    /// unoptimisable last stop, so the intermediate order is still optimised
    /// while the return leg is guaranteed.
    /// </summary>
    public bool ReturnToStart { get; set; }
    /// <summary>
    /// If set, pin this destination as the fixed last stop (Plan §Phase 2 §6.3
    /// Finish at specific stop). Value is the destination's Name (matches one
    /// of the Destinations entries).
    /// </summary>
    public string? FinishAtName { get; set; }
}

public class HereSequenceStop
{
    public string Name { get; set; } = string.Empty;
    public double Lat { get; set; }
    public double Lng { get; set; }
}

public class HereSequenceResult
{
    /// <summary>Waypoint IDs (`start`, `destination0`, ...) in HERE's optimised order.</summary>
    public List<string> OrderedWaypointIds { get; set; } = new();
    /// <summary>Names in HERE's optimised order (parallel to OrderedWaypointIds).</summary>
    public List<string> OrderedNames { get; set; } = new();
    /// <summary>Total wall-clock minutes for the route.</summary>
    public double TotalMinutes { get; set; }
    /// <summary>Per-hop travel minutes. Length = OrderedNames.Count (first entry = 0, entry N = leg from N-1 to N).</summary>
    public List<double> LegMinutes { get; set; } = new();
}

/// <summary>
/// HERE Routing v8 polyline draw request. Stops must already be in the
/// operator-approved order (this is a draw call, not an optimise call).
/// </summary>
public class RoutePolylineRequest
{
    public List<HereSequenceStop> Stops { get; set; } = new();
}

/// <summary>
/// HERE Routing v8 polyline response: an ordered list of lat/lng points
/// (decoded from HERE's flexible polyline format) plus a null indicator that
/// callers can treat as "no route available, fall back to straight lines".
/// </summary>
public class RoutePolylineResponse
{
    public List<LatLngDto> Points { get; set; } = new();
}
