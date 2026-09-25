// Hand-authored entity for the Dispatch_LinehaulRunRoster table (Recurring
// Routes spec section 4). Backs the Linehaul Roster tab's Run x Day driver grid.
//
// Table + all indexes are pre-existing in the shared Despatch DB (verified
// 2026-08-12 via MCP on both DFRNT_SEED_CR and Despatch_Urgent_Staging).
// Fluent FK + filtered unique index config lives in
// DynamicDespatchDbContext.OnModelCreating so the EF model matches the on-disk
// schema exactly (see the __probe check in the plan file).
#nullable disable
using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("Dispatch_LinehaulRunRoster")]
public class DispatchLinehaulRunRoster
{
    [Key]
    public int LinehaulRunRosterId { get; set; }

    public int LinehaulRunId { get; set; }

    // NULL when the cell targets an Agent or NP (TargetType 2/3).
    public int? CourierId { get; set; }

    // Reserved column, not used in v1.
    public int? VehicleId { get; set; }

    // NULL when this is a recurring weekly row (DayOfWeek set instead).
    // Populated when this is a specific-date override (v1.1 date-overrides).
    public DateTime? RosterDate { get; set; }

    // 1 = Mon .. 7 = Sun (matches Configurator + tblBulkRunSchedule DOW convention).
    // NULL when RosterDate is set instead.
    public byte? DayOfWeek { get; set; }

    // Soft-delete flag. Filtered unique indexes on (LinehaulRunId, DayOfWeek)
    // and (LinehaulRunId, RosterDate) enforce one active row per (run, day).
    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public string CreatedBy { get; set; }

    // Polymorphic target flag (Recurring Routes Fixes 6): 1 = Courier, 2 = Agent,
    // 3 = NetworkPartner. NULL for legacy rows written before Fixes 6 shipped.
    public byte? TargetType { get; set; }

    // NULL when the cell targets a Courier (CourierId set instead).
    public int? AgentId { get; set; }

    public virtual TucAgent Agent { get; set; }

    public virtual TucCourier Courier { get; set; }

    public virtual TblbulkLinehaulRun LinehaulRun { get; set; }
}
