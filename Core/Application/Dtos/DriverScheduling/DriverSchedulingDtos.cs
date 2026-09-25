// DTOs for the Driver Scheduling module. Response shapes mirror the
// CourierManager mock the Configurator scheduling shell was already
// wired against (services/np_schedulingMockData.ts) - JSON contract
// stays the same so the shell can move over without a mock->real
// diff round.
//
// Request shapes are simplified vs the CourierManager BaseRequest
// pattern; RoutedOperations controllers throw InvalidOperationException
// for validation failures and let the controller translate to 400,
// which is more consistent with the rest of the app than the
// ResponseUtility.AddMessageAndReturnResponse envelope.
#nullable disable

namespace RoutedOperations.Core.Application.Dtos.DriverScheduling;

// ─── Requests ───────────────────────────────────────────────────────

public class SchedulesCreateRequest
{
    public List<SchedulesCreateItem> Schedules { get; set; } = new();
}

public class SchedulesCreateItem
{
    public DateTime BookDate { get; set; }
    public string Location { get; set; }
    public string Name { get; set; }
    public TimeSpan StartTime { get; set; }
    public TimeSpan EndTime { get; set; }
    public int Wanted { get; set; }
}

public class TimeSlotCreateRequest
{
    public DateTime BookDateTime { get; set; }
    public string Location { get; set; }
    public int? Wanted { get; set; }
    public List<string> VehicleTypes { get; set; } = new();
}

public class TimeSlotUpdateRequest
{
    public long Id { get; set; }
    public DateTime BookDateTime { get; set; }
    public int? Wanted { get; set; }
}

public class NotificationsRequest
{
    public List<long> Ids { get; set; } = new();
}

public class ScheduleResponseTimeSlotAssignRequest
{
    public long Id { get; set; }
    public long? TimeSlotId { get; set; }
}

public class ScheduleResponseStatusUpdateRequest
{
    public List<long> Ids { get; set; } = new();
    public int StatusId { get; set; }
}

public class ScheduleCopyRequest
{
    public DateTime SourceDate { get; set; }
    public DateTime DestinationDate { get; set; }
    public List<string> Locations { get; set; } = new();
}

// ─── Response DTOs ──────────────────────────────────────────────────

public class LocationSummaryDto
{
    public string Location { get; set; }
    public int TotalCouriers { get; set; }
    public int TotalAvailable { get; set; }
    public List<ScheduleSummaryDto> ScheduleSummaries { get; set; } = new();
    public List<TimeSlotVehicleDto> TimeSlots { get; set; } = new();
}

public class ScheduleSummaryDto
{
    public long Id { get; set; }
    public DateTime Created { get; set; }
    public DateTime BookDate { get; set; }
    public string Location { get; set; }
    public string Name { get; set; }
    public DateTime? NotificationSent { get; set; }
    public TimeSpan StartTime { get; set; }
    public TimeSpan EndTime { get; set; }
    public int Wanted { get; set; }
    public int Available { get; set; }
    public List<VehicleSummaryDto> VehicleSummaries { get; set; } = new();
}

public class VehicleSummaryDto
{
    public string Vehicle { get; set; }
    public int Available { get; set; }
    public int Total { get; set; }
}

public class TimeSlotVehicleDto
{
    public long Id { get; set; }
    public string Location { get; set; }
    public DateTime BookDateTime { get; set; }
    public int? Wanted { get; set; }
    public List<string> VehicleTypes { get; set; } = new();
}

public class TimeSlotDto
{
    public long Id { get; set; }
    public string Location { get; set; }
    public DateTime BookDateTime { get; set; }
    public int? Wanted { get; set; }
}

public class ScheduleDto
{
    public long Id { get; set; }
    public DateTime Created { get; set; }
    public DateTime BookDate { get; set; }
    public string Location { get; set; }
    public string Name { get; set; }
    public DateTime? NotificationSent { get; set; }
    public TimeSpan StartTime { get; set; }
    public TimeSpan EndTime { get; set; }
    public int Wanted { get; set; }
}

public class CourierByScheduleDto
{
    public CourierDetailsDto Courier { get; set; }
    public ScheduleResponseDto ScheduleResponse { get; set; }
}

public class CourierDetailsDto
{
    public int Id { get; set; }
    public string Code { get; set; }
    public string FirstName { get; set; }
    public string Surname { get; set; }
    public string Mobile { get; set; }
    public string VehicleType { get; set; }
    public string Region { get; set; }
    public bool Active { get; set; }
}

public class ScheduleResponseDto
{
    public long Id { get; set; }
    public DateTime Created { get; set; }
    public DateTime Updated { get; set; }
    public int StatusId { get; set; }
    public string Status { get; set; }
    public TimeSlotDto TimeSlot { get; set; }
}

// Lookup row for the two frontend dropdowns the operator needs when
// creating schedules + time slots (locations = active bulk regions,
// vehicleTypes = the VehicleType lookup table). Kept as a plain
// {Id,Name} pair so the same shape covers both endpoints - the legacy
// CourierManager UI had two separate services for these and the port
// was silently regressing to free-text inputs.
public class LookupItemDto
{
    public int Id { get; set; }
    public string Name { get; set; }
}
