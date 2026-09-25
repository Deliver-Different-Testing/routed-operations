// Recurring Routes Linehaul port (2026-08-12). DTOs for the Linehaul tab + the
// Linehaul Roster tab + Mapped Stops drill-down. Mirrors the Configurator
// TenantLinehaulDtos shape so a route created here shows up cleanly in
// DF Admin > Operations > Recurring Routes > Linehaul.
//
// Source of truth (do not diverge without updating both):
//   C:\Gitlab\Configurator_Root\Configurator\Core\Application\Dtos\Tenant\TenantLinehaulDtos.cs
using System.Collections.Generic;

namespace RoutedOperations.Core.Application.Dtos.RecurringLinehaul;

// One depot-to-depot middle-mile run. Server resolves depot / driver names +
// the two counts (Mapped Stops, Used By Schedules) so the front-end renders
// each row without a join.
public class RecurringLinehaulRunDto
{
    public int Id { get; set; }
    public string RunName { get; set; } = string.Empty;
    public int FromDepotId { get; set; }
    public int ToDepotId { get; set; }
    public string FromDepotName { get; set; } = string.Empty;
    public string ToDepotName { get; set; } = string.Empty;
    public string? StartTime { get; set; }      // "HH:mm" (null when unset)
    public string? DespatchTime { get; set; }   // "HH:mm" (null when unset)
    public int? CourierId { get; set; }         // null when unbound (or when Agent/NP)
    public string? DefaultDriverName { get; set; }
    // Polymorphic default target (Fixes 5). CourierId/DefaultDriverName kept
    // for back-compat with the roster courier fallback.
    public int? DefaultAgentId { get; set; }
    public string? DefaultTargetType { get; set; }   // "Courier" / "Agent" / "NetworkPartner" / null
    public int? DefaultTargetId { get; set; }
    public string? DefaultTargetName { get; set; }
    public string? DefaultTargetHint { get; set; }
    // Run-level Speed override (Fix 8). null = inherit schedule.
    public int? SpeedId { get; set; }
    // 1 = Road (default), 2 = Flight.
    public byte Mode { get; set; }
    // Master booking (tucJobBooking WHERE LinehaulRunId = Id AND IsLinehaulMaster = 1).
    // null = none linked yet.
    public int? MasterBookingId { get; set; }
    public string? MasterBookingLabel { get; set; }  // "jobNo - name/client" for display
    public int MappedStopsCount { get; set; }        // tblBulkJob WHERE LinehaulRunID = Id AND !Void
    public int UsedBySchedulesCount { get; set; }    // distinct logical schedules bound to this run
    public bool Active { get; set; }                 // derived: >=1 active schedule binding
}

// Create / update payload. Optional string fields are nullable so a PUT that
// omits an untouched field doesn't trip [ApiController] implicit-required 400s.
public class RecurringLinehaulRunUpsertDto
{
    public string? RunName { get; set; }
    public int FromDepotId { get; set; }
    public int ToDepotId { get; set; }
    public string? StartTime { get; set; }      // "HH:mm"
    public string? DespatchTime { get; set; }   // "HH:mm"
    // Polymorphic default target (replaces courier-only). null type => unbound.
    public string? DefaultTargetType { get; set; }
    public int? DefaultTargetId { get; set; }
    // Run-level Speed override (TucJobType.UcjtId). null = inherit schedule.
    public int? SpeedId { get; set; }
    // 1 = Road, 2 = Flight. null/omitted => Road.
    public byte? Mode { get; set; }
    // Master job to mark for this run. null = clear/no master.
    public int? MasterBookingId { get; set; }
}

public class RecurringLinehaulDepotLookupDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
}

public class RecurringLinehaulCourierLookupDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
}

public class RecurringLinehaulLookupsDto
{
    public List<RecurringLinehaulDepotLookupDto> Depots { get; set; } = [];
    public List<RecurringLinehaulCourierLookupDto> Couriers { get; set; } = [];
}

// One schedule that binds a linehaul run (Fixes 7 - "Used by Schedules" drill).
// Weekday-variant binding rows are collapsed to one logical schedule.
public class RecurringLinehaulScheduleBindingDto
{
    public int? ScheduleId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool Active { get; set; }
    public string? WeekDay { get; set; }
}

// Candidate booking for the "link master job" picker on a Linehaul Run.
public class RecurringLinehaulBookingLookupDto
{
    public int BookingId { get; set; }
    public string JobNumber { get; set; } = string.Empty;
    public string? JobName { get; set; }
    public string? ClientName { get; set; }
    public string? PickupSummary { get; set; }
    public string? DeliverySummary { get; set; }
    public int? LinkedRunId { get; set; }
    public bool IsMaster { get; set; }
    public bool LinkedToThisRun { get; set; }
}

// Linehaul Roster (spec 4 + Fixes 6): Run x Day target grid.

public class LinehaulRosterCellDto
{
    public int RosterId { get; set; }
    public int DayOfWeek { get; set; }   // 1 = Mon .. 7 = Sun
    // Courier fields kept for the driver filter + back-compat; null for Agent/NP.
    public int? CourierId { get; set; }
    public string? CourierName { get; set; }
    // Polymorphic target (Fixes 6).
    public string? TargetType { get; set; }
    public int? TargetId { get; set; }
    public string? TargetName { get; set; }
    public string? TargetHint { get; set; }
}

public class LinehaulRosterRowDto
{
    public int RunId { get; set; }
    public string RunName { get; set; } = string.Empty;
    public string FromDepotName { get; set; } = string.Empty;
    public string ToDepotName { get; set; } = string.Empty;
    public int? DefaultCourierId { get; set; }
    public string? DefaultDriverName { get; set; }
    // Run's default target (whichever type). Cells pre-fill from this in the picker.
    public string? DefaultTargetType { get; set; }
    public int? DefaultTargetId { get; set; }
    public string? DefaultTargetName { get; set; }
    public string? DefaultTargetHint { get; set; }
    public bool Active { get; set; }   // derived: run has >=1 active schedule binding
    public List<LinehaulRosterCellDto> Cells { get; set; } = [];
}

public class LinehaulRosterGridDto
{
    public List<LinehaulRosterRowDto> Rows { get; set; } = [];
    public List<RecurringLinehaulCourierLookupDto> Couriers { get; set; } = [];
}

public class LinehaulRosterUpsertDto
{
    public int LinehaulRunId { get; set; }
    public int DayOfWeek { get; set; }   // 1 = Mon .. 7 = Sun
    // Polymorphic target (replaces courier-only).
    public string? TargetType { get; set; }
    public int TargetId { get; set; }
}

// Service-level outcome so the controller can map to the right HTTP status
// without throwing for expected cases (not-found / blocked / validation).
public class RecurringLinehaulMutationResult
{
    public RecurringLinehaulRunDto? Dto { get; set; }
    public bool NotFound { get; set; }
    public bool BlockedBySchedules { get; set; }
    public string? ValidationError { get; set; }

    public static RecurringLinehaulMutationResult Ok(RecurringLinehaulRunDto dto) => new() { Dto = dto };
    public static RecurringLinehaulMutationResult NotFoundResult() => new() { NotFound = true };
    public static RecurringLinehaulMutationResult Blocked() => new() { BlockedBySchedules = true };
    public static RecurringLinehaulMutationResult Invalid(string error) => new() { ValidationError = error };
}
