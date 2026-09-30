// Audit table for every UTL_stpRouteAutoAssign_Resolve decision. Rows are
// inserted by the SP itself (see migration 20260611150000_AddRoutedFlagAnd
// RouteAutoAssignLog.sql). Consumed here by the Auto-Assign Log diagnostic
// page so ops can answer "why did this booking get this route?" without
// spelunking SSMS.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("RouteAutoAssignLog")]
public partial class RouteAutoAssignLog
{
    [Key]
    public long LogId { get; set; }

    [Column(TypeName = "datetime2")]
    public DateTime CreatedAtUtc { get; set; }

    public int? JobId { get; set; }
    public int? JobBookingId { get; set; }
    public int? SpeedId { get; set; }

    [MaxLength(10)]
    public string PickupZip { get; set; }

    [Column(TypeName = "datetime2")]
    public DateTime? PickupAtUtc { get; set; }

    /// <summary>Tiny int discriminator for the booking source that triggered
    /// the resolver call. See AutoAssignLogService.BookingKindName for the
    /// friendly-name mapping (Recurring / RecurringSchedule / etc.).</summary>
    public byte? BookingKind { get; set; }

    public int? ResolvedRouteId { get; set; }
    public int? ResolvedCourierId { get; set; }
    public int? ResolvedNpAgentId { get; set; }
    public int? ResolvedAgentId { get; set; }

    /// <summary>Resolver outcome string; e.g. AssignedToRoute,
    /// AssignedToRouteViaCustomPolygon, NoMatch, NoWindowMatch, Ambiguous.</summary>
    [Required]
    [MaxLength(40)]
    public string Outcome { get; set; }

    /// <summary>SP / caller identifier that invoked the resolver (e.g.
    /// DDStpJob_InsertExcelerator, WSStpJob_Insert, etc.).</summary>
    [Required]
    [MaxLength(30)]
    public string TriggerSource { get; set; }

    /// <summary>Route id already stamped on the booking BEFORE resolution.
    /// Non-null when Rule 1 (explicit route wins) applies.</summary>
    public int? PriorRouteId { get; set; }

    /// <summary>Which leg was resolved: 'Pickup' or 'Delivery'.</summary>
    [Required]
    [MaxLength(10)]
    public string Side { get; set; }

    /// <summary>Feature 5.2. Which of the delivery side's three attempts
    /// produced the resolution: 'FM-Depot' (a final-mile route bound to the
    /// origin depot), 'FM-Addr' (a final-mile route whose address origin sat
    /// within its radius of the pickup point), or 'Legacy' (no direction
    /// filter, i.e. what every caller got before this feature).
    ///
    /// NULL on every pickup-side row and on every row written before the
    /// feature shipped. Deliberately a separate nullable column rather than a
    /// TriggerSource suffix: TriggerSource is varchar(30) whose longest live
    /// value is already 20 characters, so a suffix would truncate silently at
    /// the parameter boundary.
    ///
    /// DEPLOY ORDER: dbmigrationsv2 20260930170000 adds the column. EF
    /// projects every mapped property, so this must not reach a tenant before
    /// that migration does or the /api/auto-assign-log feed breaks outright.
    /// </summary>
    [MaxLength(20)]
    public string MatchStrategy { get; set; }
}
