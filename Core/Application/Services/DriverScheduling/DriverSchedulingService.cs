// Ported from CourierManager/Core/Application/Services/ScheduleService.cs
// (839 lines, 14 public methods). Behaviour is preserved verbatim -
// same validation guards, same DB round-trip shape, same SMS message
// text - modulo the two per-tenant abstractions:
//
//   `+64 -> 0` phone normalisation             -> IPhoneNormaliser
//   `https://hub.urgent.deliverdifferent.com/` -> IHubUrlProvider
//
// The two overbooking triggers on `CourierScheduleResponse`
// (`TR_CourierScheduleResponse_Insert / _Update`) fire `RAISERROR('Time
// Slot has already been filled.', 16, 1)` when the trigger detects
// Wanted <= count(Available responses). We catch that SqlException and
// translate to a clean InvalidOperationException the controller maps
// to 409, matching the legacy DbUpdateException catch pattern.
//
// Tenant time comes from the existing RoutedOperations TimeZoneUtility
// (reads the `TimeZone` auth claim); no need for a bespoke
// TimeZoneService like CourierManager had.

using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.DriverScheduling;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.DriverScheduling;

public class DriverSchedulingService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IHttpContextAccessor httpContextAccessor,
    IPhoneNormaliser phoneNormaliser,
    IHubUrlProvider hubUrlProvider)
    : BaseService(contextFactory)
{
    private DateTime TenantNow() => TimeZoneUtility.GetTenantNow(httpContextAccessor);

    private DateTime ToTenantTime(DateTime dt) =>
        TimeZoneUtility.ConvertToTenantTime(dt, httpContextAccessor);

    // ─── Reads ─────────────────────────────────────────────────────

    /// <summary>Location-grouped schedules + time slots for a single
    /// book date. Fuels the main Driver Scheduling page.</summary>
    public async Task<List<LocationSummaryDto>> GetSummariesByBookDateAsync(DateTime bookDate)
    {
        // Route param `/summaries/{bookDate}` is the operator's tenant-
        // local calendar date. Take the .Date component as-is; do NOT
        // send through ConvertToTenantTime (which treats Unspecified as
        // UTC and can shift the day by tenant offset).
        var date = bookDate.Date;

        var schedules = await Context.CourierSchedules
            .Include(s => s.Location)
            .Include(s => s.CourierScheduleResponses)
            .Where(s => s.BookDate.Date == date)
            .ToListAsync();

        var timeSlots = await Context.CourierScheduleTimeSlots
            .Include(t => t.Location)
            .Include(t => t.CourierScheduleTimeSlotVehicleTypes)
                .ThenInclude(v => v.VehicleType)
            .Where(t => t.BookDateTime.Date == date)
            .ToListAsync();

        var couriers = await Context.TucCouriers
            .Where(c => c.Active && !c.UccrInternal)
            .ToListAsync();

        return schedules
            .Select(s => s.Location)
            .Distinct()
            .OrderBy(l => l?.Name ?? "Unassigned")
            .Select(l => new LocationSummaryDto
            {
                Location = l?.Name ?? "Unassigned",
                TotalCouriers = couriers.Count(c => c.RegionId == l?.BulkRegionId),
                TotalAvailable = couriers.Count(c => c.RegionId == l?.BulkRegionId
                    && schedules.Any(s => s.LocationId == c.RegionId
                        && s.CourierScheduleResponses.Any(r => r.CourierId == c.UccrId && r.StatusId == 1))),
                ScheduleSummaries = schedules
                    .Where(s => s.LocationId == l?.BulkRegionId)
                    .Select(s => new ScheduleSummaryDto
                    {
                        Id = s.Id,
                        Created = s.Created,
                        BookDate = s.BookDate,
                        Location = s.Location?.Name ?? "Unassigned",
                        Name = s.Name,
                        NotificationSent = s.NotificationSent,
                        StartTime = s.StartTime.ToTimeSpan(),
                        EndTime = s.EndTime.ToTimeSpan(),
                        Wanted = s.Wanted,
                        Available = s.CourierScheduleResponses.Count(r =>
                            r.StatusId == 1 && couriers.Any(c => c.UccrId == r.CourierId)),
                        VehicleSummaries = couriers
                            .Where(c => c.RegionId == l?.BulkRegionId)
                            .GroupBy(c => c.UccrVehicle)
                            .Select(v => new VehicleSummaryDto
                            {
                                Vehicle = v.Key ?? "Unassigned",
                                Available = s.CourierScheduleResponses.Count(r =>
                                    r.StatusId == 1 && v.Any(x => x.UccrId == r.CourierId)),
                                Total = v.Count(),
                            }).ToList(),
                    }).ToList(),
                TimeSlots = timeSlots
                    .Where(t => t.LocationId == l?.BulkRegionId)
                    .OrderBy(t => t.BookDateTime)
                    .Select(t => new TimeSlotVehicleDto
                    {
                        Id = t.Id,
                        Location = t.Location?.Name ?? "Unassigned",
                        BookDateTime = t.BookDateTime,
                        Wanted = t.Wanted,
                        VehicleTypes = t.CourierScheduleTimeSlotVehicleTypes
                            .OrderBy(v => v.VehicleType.Name)
                            .Select(v => v.VehicleType.Name)
                            .ToList(),
                    }).ToList(),
            })
            .ToList();
    }

    /// <summary>Couriers who could take the given schedule (in-region,
    /// active, non-internal) with their current response state. Only
    /// meaningful once the schedule has been notified.</summary>
    public async Task<List<CourierByScheduleDto>> GetCouriersByScheduleAsync(long scheduleId)
    {
        var schedule = await Context.CourierSchedules
            .Include(s => s.Location)
            .Include(s => s.CourierScheduleResponses)
                .ThenInclude(r => r.TimeSlot).ThenInclude(t => t.Location)
            .Include(s => s.CourierScheduleResponses)
                .ThenInclude(r => r.Status)
            .FirstOrDefaultAsync(s => s.Id == scheduleId)
            ?? throw new InvalidOperationException("Schedule not found.");

        // Not notified yet = no courier picker.
        if (!schedule.NotificationSent.HasValue) return new List<CourierByScheduleDto>();

        var couriers = await Context.TucCouriers
            .Where(c => c.Active
                && !c.UccrInternal
                && c.RegionId == schedule.LocationId)
            .ToListAsync();

        return couriers
            .Select(c => new CourierByScheduleDto
            {
                Courier = MapToCourierDto(c),
                ScheduleResponse = schedule.CourierScheduleResponses
                    .Where(r => r.CourierId == c.UccrId)
                    .Select(r => new ScheduleResponseDto
                    {
                        Id = r.Id,
                        Created = r.Created,
                        Updated = r.Updated,
                        StatusId = r.Status.Id,
                        Status = r.Status.Name,
                        TimeSlot = r.TimeSlot == null ? null : new TimeSlotDto
                        {
                            Id = r.TimeSlot.Id,
                            Location = r.TimeSlot.Location?.Name ?? "Unassigned",
                            BookDateTime = r.TimeSlot.BookDateTime,
                            Wanted = r.TimeSlot.Wanted,
                        },
                    })
                    .FirstOrDefault(),
            })
            .ToList();
    }

    /// <summary>Schedules from today onwards that have not been
    /// notified yet - fuels the "pending notification" panel.</summary>
    public async Task<List<ScheduleDto>> GetScheduleNotificationsAsync()
    {
        var tenantTime = TenantNow();
        var schedules = await Context.CourierSchedules
            .Include(s => s.Location)
            .Where(s => s.BookDate >= tenantTime.Date)
            .ToListAsync();

        return schedules
            .Where(s => !s.NotificationSent.HasValue
                && !DriverSchedulingUtility.HasStarted(s, tenantTime))
            .Select(MapScheduleDto)
            .ToList();
    }

    /// <summary>Couriers filtered by response status across every
    /// upcoming schedule. StatusId=0 = "not responded yet" set,
    /// otherwise the exact StatusId lookup.</summary>
    public async Task<List<CourierDetailsDto>> GetCouriersByResponseStatusAsync(int statusId)
    {
        var tenantTime = TenantNow();

        var schedules = await Context.CourierSchedules
            .Include(s => s.Location)
            .Include(s => s.CourierScheduleResponses)
                .ThenInclude(r => r.Courier)
            .Where(s => s.BookDate.Date >= tenantTime.Date)
            .ToListAsync();

        if (statusId == 0)
        {
            var couriers = await Context.TucCouriers
                .Where(c => c.Active && !c.UccrInternal)
                .ToListAsync();

            return couriers
                .Where(c => schedules.Any(s => s.NotificationSent.HasValue
                    && s.LocationId == c.RegionId
                    && s.CourierScheduleResponses.All(r => r.CourierId != c.UccrId)
                    && !DriverSchedulingUtility.HasStarted(s, tenantTime)))
                .Select(MapToCourierDto)
                .ToList();
        }

        return schedules
            .Where(s => s.NotificationSent.HasValue
                && DriverSchedulingUtility.HasNotEnded(s, tenantTime))
            .SelectMany(s => s.CourierScheduleResponses)
            .Where(r => r.Courier.Active && !r.Courier.UccrInternal && r.StatusId == statusId)
            .Select(r => r.Courier)
            .Distinct()
            .Select(MapToCourierDto)
            .ToList();
    }

    /// <summary>Lookup: active bulk regions the operator can pick when
    /// creating a schedule. Matches the legacy CourierManager `Locations`
    /// endpoint used by its scheduler dropdown - port had regressed to a
    /// free-text input which meant typos landed as 400 on save.</summary>
    public async Task<List<LookupItemDto>> GetLocationsAsync()
    {
        return await Context.TblBulkRegions
            .Where(r => r.Active == true)
            .OrderBy(r => r.Name)
            .Select(r => new LookupItemDto { Id = r.BulkRegionId, Name = r.Name })
            .ToListAsync();
    }

    /// <summary>Lookup: vehicle types the operator can attach to a time
    /// slot. Matches the legacy CourierManager `Vehicles/Types` endpoint.
    /// Port had regressed to a comma-separated free-text field which
    /// meant "Car" vs "car" typos rejected at save time.</summary>
    public async Task<List<LookupItemDto>> GetVehicleTypesAsync()
    {
        return await Context.VehicleTypes
            .OrderBy(v => v.Name)
            .Select(v => new LookupItemDto { Id = v.Id, Name = v.Name })
            .ToListAsync();
    }

    // ─── Writes: schedules ─────────────────────────────────────────

    /// <summary>Batch-create schedules. Rejects the whole batch if any
    /// (BookDate, Location, Name) triple already exists or references
    /// an unknown location.</summary>
    public async Task<List<ScheduleDto>> CreateAsync(SchedulesCreateRequest request)
    {
        if (request.Schedules.Count == 0) return new List<ScheduleDto>();

        // Defensive server-side validation. Frontend NewScheduleModal
        // catches these before submit, but API callers (or a bad-actor
        // request) bypass the modal - and the legacy CourierManager port
        // accepted wanted=-5 and startTime>=endTime silently, producing
        // schedules that no time slot could fit.
        if (request.Schedules.Any(s => s.Wanted < 1))
            throw new InvalidOperationException("Wanted (target headcount) must be at least 1.");
        if (request.Schedules.Any(s => s.StartTime >= s.EndTime))
            throw new InvalidOperationException("Start time must be before end time.");

        var bookDates = request.Schedules.Select(x => x.BookDate.Date).ToList();
        var existing = await Context.CourierSchedules
            .Include(s => s.Location)
            .Where(s => bookDates.Contains(s.BookDate.Date))
            .ToListAsync();

        if (request.Schedules.Any(s => existing.Any(x =>
            x.BookDate.Date == s.BookDate.Date
            && x.Location != null
            && string.Equals(x.Location.Name, s.Location, StringComparison.OrdinalIgnoreCase)
            && string.Equals(x.Name?.Trim(), s.Name?.Trim(), StringComparison.OrdinalIgnoreCase))))
        {
            throw new InvalidOperationException("Schedule for book date, location and name already exists.");
        }

        var locationNames = request.Schedules.Select(s => s.Location).Distinct().ToList();
        var locations = await Context.TblBulkRegions
            .Where(r => locationNames.Contains(r.Name))
            .ToListAsync();

        if (locationNames.Count != locations.Count)
            throw new InvalidOperationException("Unknown location.");

        var tenantTime = TenantNow();
        var schedules = request.Schedules
            .Select(s => new CourierSchedule
            {
                Created = tenantTime,
                BookDate = s.BookDate.Date,
                Location = locations.Single(x => x.Name == s.Location),
                Name = s.Name,
                StartTime = TimeOnly.FromTimeSpan(s.StartTime),
                EndTime = TimeOnly.FromTimeSpan(s.EndTime),
                Wanted = s.Wanted,
            })
            .ToList();

        Context.CourierSchedules.AddRange(schedules);
        await Context.SaveChangesAsync();

        return schedules.Select(MapScheduleDto).ToList();
    }

    /// <summary>Delete a schedule. Blocked once NotificationSent is
    /// set - couriers have already been asked, changing the shape
    /// after that would strand them.</summary>
    public async Task DeleteAsync(long id)
    {
        var schedule = await Context.CourierSchedules.FirstOrDefaultAsync(s => s.Id == id)
            ?? throw new InvalidOperationException("Schedule not found.");

        if (schedule.NotificationSent.HasValue)
            throw new InvalidOperationException(
                "Deleting a schedule when notification has been sent is not permitted.");

        Context.CourierSchedules.Remove(schedule);
        await Context.SaveChangesAsync();
    }

    /// <summary>Send SMS notifications for the given schedule ids.
    /// Only schedules not yet started + not yet notified are eligible.
    /// Fires one SMS per courier in the schedule's region.</summary>
    public async Task SendNotificationsAsync(NotificationsRequest request)
    {
        var tenantTime = TenantNow();

        var schedules = await Context.CourierSchedules
            .Where(s => s.BookDate >= tenantTime.Date)
            .ToListAsync();

        var newSchedules = schedules
            .Where(s => !DriverSchedulingUtility.HasStarted(s, tenantTime)
                && !s.NotificationSent.HasValue
                && request.Ids.Contains(s.Id))
            .ToList();

        if (newSchedules.Count == 0) return;

        var locationIds = new HashSet<int>();
        foreach (var s in newSchedules)
        {
            s.NotificationSent = tenantTime;
            if (s.LocationId.HasValue) locationIds.Add(s.LocationId.Value);
        }

        var courierMobiles = await Context.TucCouriers
            .Where(c => c.Active
                && !c.UccrInternal
                && c.RegionId.HasValue
                && locationIds.Contains(c.RegionId.Value))
            .Select(c => new { c.Code, c.PersonalMobile, c.UccrMobile })
            .ToListAsync();

        var hubUrl = hubUrlProvider.GetHubUrl();
        var hubTail = string.IsNullOrWhiteSpace(hubUrl) ? "" : $"  {hubUrl}";

        var messages = courierMobiles
            .Where(c => !string.IsNullOrWhiteSpace(c.PersonalMobile) || !string.IsNullOrWhiteSpace(c.UccrMobile))
            .Select(c => new TucManualMessage
            {
                UcmmDate = tenantTime,
                UcmmStaffId = 0,
                UcmmAttempts = 0,
                SendToMobile = phoneNormaliser.NormaliseForSms(
                    string.IsNullOrWhiteSpace(c.PersonalMobile) ? c.UccrMobile : c.PersonalMobile),
                UcmmMessage = "The schedule for your location has been updated.  Please login to the Courier Portal to view and confirm your availability." + hubTail,
                Subject = $"SMS to Courier: {c.Code}",
            })
            .ToList();

        if (messages.Count > 0) Context.TucManualMessages.AddRange(messages);

        await Context.SaveChangesAsync();
    }

    /// <summary>Send a reminder SMS to every courier who confirmed
    /// Available on the schedule. Schedule must be notified + not yet
    /// started.</summary>
    public async Task SendScheduleRemindersAsync(long scheduleId)
    {
        var schedule = await Context.CourierSchedules
            .Include(s => s.CourierScheduleResponses)
                .ThenInclude(r => r.Courier)
            .Include(s => s.CourierScheduleResponses)
                .ThenInclude(r => r.TimeSlot)
            .FirstOrDefaultAsync(s => s.Id == scheduleId)
            ?? throw new InvalidOperationException("Schedule not found.");

        if (!schedule.NotificationSent.HasValue)
            throw new InvalidOperationException("Schedule is inactive.");

        var tenantTime = TenantNow();
        if (DriverSchedulingUtility.HasStarted(schedule, tenantTime))
            throw new InvalidOperationException("Schedule has started or is in the past.");

        var hubUrl = hubUrlProvider.GetHubUrl();
        var hubTail = string.IsNullOrWhiteSpace(hubUrl) ? "" : $"  {hubUrl}";

        var messages = schedule.CourierScheduleResponses
            .Where(r => r.StatusId == 1
                && r.Courier.Active
                && (!string.IsNullOrWhiteSpace(r.Courier.PersonalMobile) || !string.IsNullOrWhiteSpace(r.Courier.UccrMobile)))
            .Select(r => new TucManualMessage
            {
                UcmmDate = tenantTime,
                UcmmStaffId = 0,
                UcmmAttempts = 0,
                SendToMobile = phoneNormaliser.NormaliseForSms(
                    string.IsNullOrWhiteSpace(r.Courier.PersonalMobile) ? r.Courier.UccrMobile : r.Courier.PersonalMobile),
                Subject = $"SMS to Courier: {r.Courier.Code}",
                UcmmMessage = $"Reminder: Schedule {schedule.BookDate.ToLongDateString()} ({schedule.Name?.Trim()}) is confirmed"
                    + (r.TimeSlot != null ? $" for {r.TimeSlot.BookDateTime.ToString("h:mm tt")}" : string.Empty)
                    + $".  Please ensure you are on site and ready to go." + hubTail,
            })
            .ToList();

        if (messages.Count == 0) return;
        Context.TucManualMessages.AddRange(messages);
        await Context.SaveChangesAsync();
    }

    /// <summary>Copy every schedule + time slot from SourceDate to
    /// DestinationDate for the given location names. Blocks if a
    /// same-Name schedule already exists on DestinationDate.</summary>
    public async Task CopyAsync(ScheduleCopyRequest request)
    {
        // Operator-supplied tenant-local dates (see TimeSlotCreateAsync
        // for the ToTenantTime pitfall). Take the calendar date as-is.
        var sourceDate = request.SourceDate.Date;
        var destinationDate = request.DestinationDate.Date;

        var schedules = await Context.CourierSchedules
            .Include(s => s.Location)
            .Where(s => s.BookDate.Date == sourceDate && request.Locations.Contains(s.Location.Name))
            .ToListAsync();

        var timeSlots = await Context.CourierScheduleTimeSlots
            .Include(t => t.CourierScheduleTimeSlotVehicleTypes)
            .Include(t => t.Location)
            .Where(t => t.BookDateTime.Date == sourceDate && request.Locations.Contains(t.Location.Name))
            .ToListAsync();

        if (request.Locations.Any(l => schedules.All(s => s.Location?.Name != l)))
            throw new InvalidOperationException("Invalid scheduled location(s).");

        var conflictNames = schedules.Select(s => s.Name).ToList();
        if (await Context.CourierSchedules.AnyAsync(s =>
            s.BookDate.Date == destinationDate && conflictNames.Contains(s.Name)))
        {
            throw new InvalidOperationException("Schedule name(s) already exists.");
        }

        var tenantTime = TenantNow();
        Context.CourierSchedules.AddRange(schedules.Select(s => new CourierSchedule
        {
            Created = tenantTime,
            BookDate = destinationDate,
            StartTime = s.StartTime,
            EndTime = s.EndTime,
            LocationId = s.LocationId,
            SiteId = s.SiteId,
            Name = s.Name,
            Wanted = s.Wanted,
        }));

        if (timeSlots.Count > 0)
        {
            Context.CourierScheduleTimeSlots.AddRange(timeSlots.Select(t => new CourierScheduleTimeSlot
            {
                Created = tenantTime,
                LocationId = t.LocationId,
                SiteId = t.SiteId,
                BookDateTime = destinationDate.AddTicks(t.BookDateTime.TimeOfDay.Ticks),
                Wanted = t.Wanted,
                CourierScheduleTimeSlotVehicleTypes = t.CourierScheduleTimeSlotVehicleTypes
                    .Select(v => new CourierScheduleTimeSlotVehicleType
                    {
                        Created = tenantTime,
                        VehicleTypeId = v.VehicleTypeId,
                    })
                    .ToList(),
            }));
        }

        await Context.SaveChangesAsync();
    }

    // ─── Writes: time slots ────────────────────────────────────────

    /// <summary>Create a time slot inside an existing schedule window.
    /// Rejects same-time + overlapping-vehicle slots as conflicts.</summary>
    public async Task<TimeSlotVehicleDto> TimeSlotCreateAsync(TimeSlotCreateRequest request)
    {
        // Operator picks tenant-local time on the calendar (e.g. "14:00
        // on 2026-09-10"). The frontend serialises that as an unspecified
        // ISO string. TimeZoneUtility.ConvertToTenantTime treats
        // Unspecified as UTC (line 78-81) which shifts by tenant offset
        // and lands the slot on the wrong day. Take the value as-is.
        var bookDateTime = request.BookDateTime;

        var schedules = await Context.CourierSchedules
            .Include(s => s.Location)
            .Where(s => s.BookDate.Date == bookDateTime.Date
                && s.Location.Name.Trim().ToLower() == request.Location.Trim().ToLower())
            .ToListAsync();

        if (!schedules.Any(s => s.StartTime.ToTimeSpan() <= bookDateTime.TimeOfDay
            && s.EndTime.ToTimeSpan() > bookDateTime.TimeOfDay))
            throw new InvalidOperationException("No schedules found at this time slot.");

        if (await Context.CourierScheduleTimeSlots.AnyAsync(t =>
            t.BookDateTime == bookDateTime
            && (!request.VehicleTypes.Any()
                || !t.CourierScheduleTimeSlotVehicleTypes.Any()
                || t.CourierScheduleTimeSlotVehicleTypes.Any(v => request.VehicleTypes.Contains(v.VehicleType.Name)))))
        {
            throw new InvalidOperationException("Conflicting time slot.");
        }

        var vehicleTypes = await Context.VehicleTypes
            .Where(v => request.VehicleTypes.Contains(v.Name))
            .ToListAsync();

        if (request.VehicleTypes.Count != vehicleTypes.Count)
            throw new InvalidOperationException("Invalid vehicle types.");

        var tenantTime = TenantNow();
        var timeSlot = new CourierScheduleTimeSlot
        {
            Created = tenantTime,
            Location = schedules.First().Location,
            BookDateTime = bookDateTime,
            Wanted = request.Wanted,
            CourierScheduleTimeSlotVehicleTypes = vehicleTypes
                .Select(v => new CourierScheduleTimeSlotVehicleType { Created = tenantTime, VehicleType = v })
                .ToList(),
        };

        Context.CourierScheduleTimeSlots.Add(timeSlot);
        await Context.SaveChangesAsync();

        return new TimeSlotVehicleDto
        {
            Id = timeSlot.Id,
            Location = schedules.First().Location.Name,
            BookDateTime = timeSlot.BookDateTime,
            Wanted = timeSlot.Wanted,
            VehicleTypes = timeSlot.CourierScheduleTimeSlotVehicleTypes
                .OrderBy(v => v.VehicleType.Name)
                .Select(v => v.VehicleType.Name)
                .ToList(),
        };
    }

    /// <summary>Move an existing time slot to a new BookDateTime. SMS
    /// every assigned courier so they know. Rejects past-times +
    /// conflicting slots.</summary>
    public async Task<TimeSlotVehicleDto> TimeSlotUpdateAsync(TimeSlotUpdateRequest request)
    {
        // Operator-supplied tenant-local time (see TimeSlotCreateAsync
        // for the ToTenantTime pitfall). Use as-is.
        var bookDateTime = request.BookDateTime;

        var timeSlot = await Context.CourierScheduleTimeSlots
            .Include(t => t.Location)
            .Include(t => t.CourierScheduleTimeSlotVehicleTypes)
                .ThenInclude(v => v.VehicleType)
            .Include(t => t.CourierScheduleResponses)
                .ThenInclude(r => r.Schedule)
            .Include(t => t.CourierScheduleResponses)
                .ThenInclude(r => r.Courier)
            .FirstOrDefaultAsync(t => t.Id == request.Id)
            ?? throw new InvalidOperationException("Time Slot not found.");

        var tenantTime = TenantNow();
        if (timeSlot.BookDateTime <= tenantTime)
            throw new InvalidOperationException("Time Slot is in the past.");

        if (timeSlot.BookDateTime == bookDateTime)
        {
            return MapTimeSlot(timeSlot);
        }

        // EF Core can't translate TimeOnly.ToTimeSpan() to SQL, so pull
        // the candidate schedules server-side (filter by date + location
        // in SQL, cheap) then check the time-window fit in memory.
        // Matches the TimeSlotCreateAsync pattern above.
        var candidateSchedules = await Context.CourierSchedules
            .Where(s => s.BookDate.Date == bookDateTime.Date && s.LocationId == timeSlot.LocationId)
            .Select(s => new { s.StartTime, s.EndTime })
            .ToListAsync();
        if (!candidateSchedules.Any(s =>
            s.StartTime.ToTimeSpan() <= bookDateTime.TimeOfDay
            && s.EndTime.ToTimeSpan() > bookDateTime.TimeOfDay))
        {
            throw new InvalidOperationException("No schedules found at this time slot.");
        }

        if (await Context.CourierScheduleTimeSlots.AnyAsync(t =>
            t.Id != timeSlot.Id
            && t.BookDateTime == bookDateTime
            && (!timeSlot.CourierScheduleTimeSlotVehicleTypes.Any()
                || !t.CourierScheduleTimeSlotVehicleTypes.Any()
                || t.CourierScheduleTimeSlotVehicleTypes.Any(v =>
                    timeSlot.CourierScheduleTimeSlotVehicleTypes
                        .Select(x => x.VehicleTypeId)
                        .Contains(v.VehicleTypeId)))))
        {
            throw new InvalidOperationException("Conflicting time slot.");
        }

        var hubUrl = hubUrlProvider.GetHubUrl();
        var hubTail = string.IsNullOrWhiteSpace(hubUrl) ? "" : $"  {hubUrl}";

        var messages = timeSlot.CourierScheduleResponses
            .Where(r => r.Courier.Active
                && (!string.IsNullOrWhiteSpace(r.Courier.PersonalMobile) || !string.IsNullOrWhiteSpace(r.Courier.UccrMobile)))
            .Select(r => new TucManualMessage
            {
                UcmmDate = tenantTime,
                UcmmStaffId = 0,
                UcmmAttempts = 0,
                SendToMobile = phoneNormaliser.NormaliseForSms(
                    string.IsNullOrWhiteSpace(r.Courier.PersonalMobile) ? r.Courier.UccrMobile : r.Courier.PersonalMobile),
                Subject = $"SMS to Courier: {r.Courier.Code}",
                UcmmMessage = $"Schedule: {bookDateTime.Date.ToLongDateString()} ({r.Schedule.Name?.Trim()}) time slot has been changed from {timeSlot.BookDateTime.ToShortTimeString()} to {bookDateTime.ToShortTimeString()}." + hubTail,
            })
            .ToList();

        if (messages.Count > 0) Context.TucManualMessages.AddRange(messages);

        timeSlot.BookDateTime = bookDateTime;
        // Frontend Edit Time Slot modal exposes Wanted; port had the
        // legacy CourierManager oversight of ignoring it here so
        // operator edits to Wanted silently vanished on save. Persist
        // it now.
        timeSlot.Wanted = request.Wanted;
        await Context.SaveChangesAsync();

        return MapTimeSlot(timeSlot);
    }

    /// <summary>Delete a time slot. Assigned couriers fall back to
    /// reserve. Blocked once the time slot is in the past.</summary>
    public async Task TimeSlotDeleteAsync(long id)
    {
        var timeSlot = await Context.CourierScheduleTimeSlots
            .Include(t => t.CourierScheduleResponses)
            .Include(t => t.CourierScheduleTimeSlotVehicleTypes)
            .FirstOrDefaultAsync(t => t.Id == id)
            ?? throw new InvalidOperationException("Time Slot not found.");

        if (timeSlot.BookDateTime <= TenantNow())
            throw new InvalidOperationException("Time Slot is in the past.");

        if (timeSlot.CourierScheduleTimeSlotVehicleTypes.Any())
            Context.CourierScheduleTimeSlotVehicleTypes.RemoveRange(timeSlot.CourierScheduleTimeSlotVehicleTypes);

        // Deleting a time slot puts any couriers assigned to it back
        // on reserve automatically - the FK on CourierScheduleResponse
        // is nullable; we just need to null the TimeSlotId on those
        // responses. In legacy this was done via `set null` cascade
        // on the FK; EF here defaults to that behaviour too.
        foreach (var r in timeSlot.CourierScheduleResponses)
        {
            r.TimeSlotId = null;
        }

        Context.CourierScheduleTimeSlots.Remove(timeSlot);
        await Context.SaveChangesAsync();
    }

    // ─── Writes: responses ─────────────────────────────────────────

    /// <summary>Assign a courier response to a time slot (or clear it
    /// by passing null - "put on reserve"). Enforces the full ladder:
    /// courier active, response is Available, slot is future, slot
    /// matches the schedule window, courier's vehicle matches. The DB
    /// trigger `TR_CourierScheduleResponse_Update` enforces overbooking
    /// on top; we translate its RAISERROR to a clean 409.</summary>
    public async Task ScheduleResponseTimeSlotAssignAsync(ScheduleResponseTimeSlotAssignRequest request)
    {
        var scheduleResponse = await Context.CourierScheduleResponses
            .Include(r => r.Schedule)
            .Include(r => r.TimeSlot)
            .Include(r => r.Courier)
            .Include(r => r.Status)
            .FirstOrDefaultAsync(r => r.Id == request.Id)
            ?? throw new InvalidOperationException("Schedule response not found.");

        if (scheduleResponse.TimeSlotId == request.TimeSlotId) return;

        if (!scheduleResponse.Courier.Active)
            throw new InvalidOperationException("Courier is inactive.");

        if (scheduleResponse.StatusId != 1)
            throw new InvalidOperationException(
                $"Time slot assignment for a schedule response with a status of '{scheduleResponse.Status.Name}' is not permitted.");

        CourierScheduleTimeSlot? timeSlot = null;
        if (request.TimeSlotId.HasValue)
        {
            timeSlot = await Context.CourierScheduleTimeSlots
                .Include(t => t.CourierScheduleTimeSlotVehicleTypes)
                    .ThenInclude(v => v.VehicleType)
                .FirstOrDefaultAsync(t => t.Id == request.TimeSlotId.Value)
                ?? throw new InvalidOperationException("Time slot not found.");
        }

        var tenantTime = TenantNow();
        if (timeSlot != null && timeSlot.BookDateTime <= tenantTime)
            throw new InvalidOperationException("Time slot must not be in the past.");

        if (timeSlot != null && (
            timeSlot.BookDateTime.Date != scheduleResponse.Schedule.BookDate.Date
            || timeSlot.BookDateTime.TimeOfDay < scheduleResponse.Schedule.StartTime.ToTimeSpan()
            || timeSlot.BookDateTime.TimeOfDay >= scheduleResponse.Schedule.EndTime.ToTimeSpan()))
        {
            throw new InvalidOperationException("Invalid time slot for schedule.");
        }

        if (timeSlot != null
            && timeSlot.CourierScheduleTimeSlotVehicleTypes.Any()
            && timeSlot.CourierScheduleTimeSlotVehicleTypes.All(v =>
                v.VehicleType.Name.Trim().ToLower() != scheduleResponse.Courier.UccrVehicle?.Trim().ToLower()))
        {
            throw new InvalidOperationException("Invalid time slot for vehicle type.");
        }

        // Only SMS on a real (non-reserve) assignment with a mobile.
        if (timeSlot != null
            && (!string.IsNullOrWhiteSpace(scheduleResponse.Courier.PersonalMobile)
                || !string.IsNullOrWhiteSpace(scheduleResponse.Courier.UccrMobile)))
        {
            var hubUrl = hubUrlProvider.GetHubUrl();
            var hubTail = string.IsNullOrWhiteSpace(hubUrl) ? "" : $"  {hubUrl}";
            var mobile = string.IsNullOrWhiteSpace(scheduleResponse.Courier.PersonalMobile)
                ? scheduleResponse.Courier.UccrMobile
                : scheduleResponse.Courier.PersonalMobile;

            Context.TucManualMessages.Add(new TucManualMessage
            {
                UcmmDate = tenantTime,
                UcmmStaffId = 0,
                UcmmAttempts = 0,
                SendToMobile = phoneNormaliser.NormaliseForSms(mobile),
                Subject = $"SMS to Courier: {scheduleResponse.Courier.Code}",
                UcmmMessage = $"Schedule: {scheduleResponse.Schedule.BookDate.Date.ToLongDateString()} ({scheduleResponse.Schedule.Name?.Trim()}) time slot has been changed"
                    + (scheduleResponse.TimeSlot == null ? string.Empty : $" from {scheduleResponse.TimeSlot.BookDateTime.ToShortTimeString()}")
                    + $" to {timeSlot.BookDateTime.ToShortTimeString()}." + hubTail,
            });
        }

        scheduleResponse.TimeSlotId = timeSlot?.Id;

        try
        {
            await Context.SaveChangesAsync();
        }
        catch (DbUpdateException e) when (IsTimeSlotFilledError(e))
        {
            throw new InvalidOperationException("Time Slot has already been filled.");
        }
    }

    /// <summary>Bulk-update response status (Available=1 /
    /// Unavailable=3). Blocks Available flips that would create a
    /// same-time double-booking. If flipping to Unavailable and the
    /// schedule is future, SMS the courier a "cancelled" notice.</summary>
    public async Task ScheduleResponseStatusUpdateAsync(ScheduleResponseStatusUpdateRequest request)
    {
        var scheduleResponsesToUpdate = await Context.CourierScheduleResponses
            .Include(r => r.Schedule)
            .Include(r => r.Courier)
            .Where(r => request.Ids.Contains(r.Id))
            .ToListAsync();

        if (request.Ids.Count != scheduleResponsesToUpdate.Count)
            throw new InvalidOperationException("Schedule response(s) not found.");

        var dates = scheduleResponsesToUpdate.Select(r => r.Schedule.BookDate.Date).Distinct().ToList();

        var schedules = await Context.CourierSchedules
            .Include(s => s.Location)
            .Include(s => s.CourierScheduleResponses)
            .Where(s => dates.Contains(s.BookDate.Date))
            .ToListAsync();

        if (request.StatusId == 1)
        {
            // Detect batch-internal conflicts too. If an operator flips
            // (courierX, schedA) and (courierX, schedB) to Available in a
            // single call and A overlaps B, the "currently Available"
            // snapshot has neither of them yet, so the legacy per-row
            // check would let both through and double-book the courier.
            // Build a per-courier map of "will-be-Available" schedule ids
            // from the batch itself, then check overlaps against the
            // union of (existing Available on tenant) + (batch peers).
            var batchByCourier = scheduleResponsesToUpdate
                .Where(r => r.StatusId != 1)
                .GroupBy(r => r.CourierId)
                .ToDictionary(g => g.Key, g => g.Select(r => r.Schedule).ToList());

            var conflicting = scheduleResponsesToUpdate
                .Where(r => r.StatusId != 1)
                .Where(r =>
                {
                    var existingAvailable = schedules.Where(s => s.NotificationSent.HasValue
                        && s.CourierScheduleResponses.Any(x => x.CourierId == r.CourierId && x.StatusId == 1));
                    var batchPeers = (batchByCourier.TryGetValue(r.CourierId, out var peers) ? peers : new List<CourierSchedule>())
                        .Where(s => s.Id != r.Schedule.Id);
                    return DriverSchedulingUtility.HasConflictingSchedule(
                        r.Schedule,
                        existingAvailable.Concat(batchPeers));
                })
                .ToList();

            if (conflicting.Count > 0)
                throw new InvalidOperationException("Conflicting schedule(s) found.");
        }

        if (scheduleResponsesToUpdate.Count == 0) return;

        var tenantTime = TenantNow();
        var hubUrl = hubUrlProvider.GetHubUrl();
        var hubTail = string.IsNullOrWhiteSpace(hubUrl) ? "" : $"  {hubUrl}";

        foreach (var r in scheduleResponsesToUpdate)
        {
            if (r.StatusId == request.StatusId) continue;

            r.Updated = tenantTime;
            r.StatusId = request.StatusId;

            if (r.StatusId != 3) continue;

            r.TimeSlotId = null;

            // Notify courier of the cancellation if the schedule is
            // future + the courier has a mobile.
            var stillFuture = r.Schedule.BookDate.Date > tenantTime.Date
                || (r.Schedule.BookDate.Date == tenantTime.Date
                    && r.Schedule.EndTime.ToTimeSpan() > tenantTime.TimeOfDay);
            if (!stillFuture || !r.Courier.Active) continue;
            if (string.IsNullOrWhiteSpace(r.Courier.PersonalMobile)
                && string.IsNullOrWhiteSpace(r.Courier.UccrMobile)) continue;

            var mobile = string.IsNullOrWhiteSpace(r.Courier.PersonalMobile)
                ? r.Courier.UccrMobile
                : r.Courier.PersonalMobile;

            Context.TucManualMessages.Add(new TucManualMessage
            {
                UcmmDate = tenantTime,
                UcmmStaffId = 0,
                UcmmAttempts = 0,
                SendToMobile = phoneNormaliser.NormaliseForSms(mobile),
                Subject = $"SMS to Courier: {r.Courier.Code}",
                UcmmMessage = $"Schedule: {r.Schedule.BookDate.ToLongDateString()} ({r.Schedule.Name?.Trim()}) has been cancelled." + hubTail,
            });
        }

        await Context.SaveChangesAsync();
    }

    // ─── Helpers ───────────────────────────────────────────────────

    /// <summary>Recognise the DB overbooking trigger's RAISERROR so we
    /// can translate it to a clean validation error. Matches on either
    /// the outer message or the inner SqlException message so we don't
    /// depend on EF's wrapper shape.</summary>
    private static bool IsTimeSlotFilledError(DbUpdateException e)
    {
        const string marker = "Time Slot has already been filled.";
        if (string.Equals(e.Message, marker, StringComparison.Ordinal)) return true;
        if (e.InnerException is SqlException sql
            && sql.Message.Contains(marker, StringComparison.Ordinal)) return true;
        return e.InnerException?.Message?.Contains(marker, StringComparison.Ordinal) == true;
    }

    private static ScheduleDto MapScheduleDto(CourierSchedule s) => new()
    {
        Id = s.Id,
        Created = s.Created,
        BookDate = s.BookDate,
        Location = s.Location?.Name ?? "Unassigned",
        Name = s.Name,
        NotificationSent = s.NotificationSent,
        StartTime = s.StartTime.ToTimeSpan(),
        EndTime = s.EndTime.ToTimeSpan(),
        Wanted = s.Wanted,
    };

    private static TimeSlotVehicleDto MapTimeSlot(CourierScheduleTimeSlot t) => new()
    {
        Id = t.Id,
        Location = t.Location?.Name ?? "Unassigned",
        BookDateTime = t.BookDateTime,
        Wanted = t.Wanted,
        VehicleTypes = t.CourierScheduleTimeSlotVehicleTypes
            .OrderBy(v => v.VehicleType.Name)
            .Select(v => v.VehicleType.Name)
            .ToList(),
    };

    private static CourierDetailsDto MapToCourierDto(TucCourier c) => new()
    {
        Id = c.UccrId,
        Code = c.Code,
        FirstName = c.UccrName,
        Surname = c.UccrSurname,
        Mobile = string.IsNullOrWhiteSpace(c.PersonalMobile) ? c.UccrMobile : c.PersonalMobile,
        VehicleType = c.UccrVehicle,
        Region = c.RegionId?.ToString(),
        Active = c.Active,
    };
}
