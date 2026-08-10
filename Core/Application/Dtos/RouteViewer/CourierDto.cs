// Courier DTOs for the Route Viewer Home + Mobile map + Detail panel.
// Three shapes:
// - CourierListDto for the potential-courier picker + typeahead search.
// - CourierPositionDto for the single GPS-position read.
// - CourierRoutePointDto for the courier GPS-trail polyline.
//
// SECURITY NOTE: /Courier/* endpoints all short-circuit to empty for NP
// users (master Section 3.4). This is enforced in the controller layer
// via the INpScopeResolver.IsAdmin check, not the SP.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

/// <summary>
/// Row for the potential-courier picker + typeahead search. Sourced
/// from RVW_stpActiveCouriers + RVW_stpCourierActive.
/// </summary>
public class CourierListDto
{
    public int CourierId { get; set; }
    public string? Name { get; set; }
    public string? Code { get; set; }
    public string? Fleet { get; set; }

    /// <summary>Number of jobs currently assigned. Drives the
    /// "<= 3 highlighted" bg-info state on the picker.</summary>
    public int ActiveJobs { get; set; }

    public bool IsAvailable { get; set; }

    /// <summary>Vehicle type / description string.</summary>
    public string? VehicleType { get; set; }
}

/// <summary>
/// Single courier GPS position. Sourced from
/// MAP_stpCourierGPS_LastPositionToday_ByJobID for the current-job
/// courier marker on the map. Refreshed on the 25s poll.
/// </summary>
public class CourierPositionDto
{
    public int CourierId { get; set; }
    public string? CourierCode { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public DateTime? Timestamp { get; set; }
}

/// <summary>
/// Available-courier marker on the "All Couriers" map toggle. Sourced
/// from MAP_stpEnvelope, filtered to a lat/lng bounding box supplied by
/// the current map viewport.
/// </summary>
public class AvailableCourierPositionDto
{
    public int CourierId { get; set; }
    public string? CourierCode { get; set; }
    public string? VehicleType { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public DateTime? Timestamp { get; set; }
}

/// <summary>
/// GPS-trail point for the "Courier Route" polyline. Sourced from
/// MAP_stpCourierGPS_CourierTimeTrace_New for a courier code + time
/// range window (typically pod time +/- 5 min).
/// </summary>
public class CourierRoutePointDto
{
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public DateTime Timestamp { get; set; }
}
