namespace RoutedOperations.Core.Application.Dtos.Diagnostics;

/// <summary>Query params for the Auto-Assign Log endpoint. All filters
/// optional; defaults produce a 50-row page of the last 24h.</summary>
public class RouteAutoAssignLogQuery
{
    /// <summary>Exact match on Outcome text (e.g. AssignedToRoute, NoMatch).
    /// Null / empty returns all outcomes.</summary>
    public string? Outcome { get; set; }
    /// <summary>Pickup / Delivery filter. Null returns both sides.</summary>
    public string? Side { get; set; }
    /// <summary>Inclusive lower-bound CreatedAtUtc. Defaults to now - 24h.</summary>
    public DateTime? FromUtc { get; set; }
    /// <summary>Exclusive upper-bound CreatedAtUtc. Defaults to now.</summary>
    public DateTime? ToUtc { get; set; }
    /// <summary>Filter to entries whose ResolvedRouteId equals this value.</summary>
    public int? RouteId { get; set; }
    /// <summary>1-based page number. Default 1.</summary>
    public int Page { get; set; } = 1;
    /// <summary>Page size (capped at 200 in the service). Default 50.</summary>
    public int PageSize { get; set; } = 50;
}

public record RouteAutoAssignLogEntryDto(
    long LogId,
    DateTime CreatedAtUtc,
    int? JobId,
    int? JobBookingId,
    int? SpeedId,
    string? PickupZip,
    DateTime? PickupAtUtc,
    byte? BookingKind,
    string BookingKindName,
    int? ResolvedRouteId,
    string? ResolvedRouteName,
    int? ResolvedCourierId,
    string? ResolvedCourierName,
    int? ResolvedAgentId,
    string? ResolvedAgentName,
    int? ResolvedNpAgentId,
    string? ResolvedNpAgentName,
    string Outcome,
    string TriggerSource,
    int? PriorRouteId,
    string Side);

public record RouteAutoAssignLogPageDto(
    int Total,
    int Page,
    int PageSize,
    List<RouteAutoAssignLogEntryDto> Entries);

/// <summary>Query params for the Unresolved Recurring Bookings tab.
/// Steve spec §827 diagnostic item #1 ("unresolved recurring bookings").
/// All filters optional; defaults produce first 50 rows.</summary>
public class UnresolvedRecurringBookingQuery
{
    /// <summary>Filter to bookings whose ucbkClientID equals this value.</summary>
    public int? ClientId { get; set; }
    /// <summary>Filter to bookings whose ScheduleID equals this value.</summary>
    public int? ScheduleId { get; set; }
    /// <summary>Filter to bookings whose ucbkSpeed equals this value.</summary>
    public int? SpeedId { get; set; }
    /// <summary>True = only bookings where PickUpLatitude / PickUpLongitude
    /// are NULL. Diagnoses "resolver can't run custom polygon PIP because
    /// coords missing" (Steve spec §832 diagnostic item #6). False / null
    /// returns all unresolved bookings.</summary>
    public bool? MissingPickupCoords { get; set; }
    /// <summary>1-based page number. Default 1.</summary>
    public int Page { get; set; } = 1;
    /// <summary>Page size (capped at 200 in the service). Default 50.</summary>
    public int PageSize { get; set; } = 50;
}

public record UnresolvedRecurringBookingEntryDto(
    int UcbkId,
    string? UcbkJobNumber,
    int? UcbkClientId,
    string? ClientName,
    int? UcbkSpeed,
    string? SpeedName,
    int? ScheduleId,
    string? ScheduleName,
    string? PickupZip,
    string? DeliveryZip,
    bool MissingPickupCoords,
    bool MissingDeliveryCoords,
    DateTime? UcbkNextDue,
    DateTime? CreatedTime);

public record UnresolvedRecurringBookingPageDto(
    int Total,
    int Page,
    int PageSize,
    List<UnresolvedRecurringBookingEntryDto> Entries);
