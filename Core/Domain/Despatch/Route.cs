// Ported from the Configurator scaffold. Route table holds recurring-route
// definitions (name + area + default courier/agent/NP target + schedule +
// zip coverage). Many-to-many with ZipPolygon via the RouteZipcodes junction.
//
// Configurator owns the CRUD via TenantRouteService; RoutedOperations shares
// the same table and the same shape - we surface it in the cockpit's
// "Scheduled Routes" board for operators building runs on the fly.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("Routes")]
public partial class Route
{
    [Key]
    public int RouteId { get; set; }

    [Required]
    [MaxLength(100)]
    public string Name { get; set; }

    /// <summary>Freeform region descriptor (e.g. "NeoGenomics Stockton / Modesto / Turlock evening wave").</summary>
    [Required]
    [MaxLength(100)]
    public string Area { get; set; }

    public int? DefaultCourierId { get; set; }

    public bool Active { get; set; }

    [Column(TypeName = "datetime")]
    public DateTime CreatedAt { get; set; }

    [Required]
    [MaxLength(100)]
    public string CreatedBy { get; set; }

    [Column(TypeName = "datetime")]
    public DateTime? UpdatedAt { get; set; }

    [MaxLength(100)]
    public string UpdatedBy { get; set; }

    /// <summary>Polymorphic target type: 1 = Courier, 2 = Agent, 3 = Network Partner (agent with IsNetworkPartner=1).</summary>
    public byte? DefaultTargetType { get; set; }

    public int? DefaultAgentId { get; set; }

    /// <summary>Legacy 1:1 FK into tblBulkRunSchedule (representative id of the
    /// schedule group). Superseded 2026-08-03 by the M:N Schedules collection
    /// (see the tblRouteSchedule junction). Kept on the entity so external
    /// readers that still project the column don't error; the service layer
    /// stops writing to it. New code should read/write Schedules.</summary>
    public int? ScheduleId { get; set; }

    [ForeignKey(nameof(DefaultCourierId))]
    public virtual TucCourier DefaultCourier { get; set; }

    [ForeignKey(nameof(DefaultAgentId))]
    public virtual TucAgent DefaultAgent { get; set; }

    public virtual ICollection<DispatchRouteRoster> DispatchRouteRosters { get; set; } = new List<DispatchRouteRoster>();

    /// <summary>Many-to-many with ZipPolygon via the RouteZipcodes junction (RouteId, ZipPolygonId).</summary>
    public virtual ICollection<ZipPolygon> ZipPolygons { get; set; } = new List<ZipPolygon>();

    /// <summary>Many-to-many with BulkRunPolygon via the tblBulkRunPolygonRoute junction (RouteId, PolygonId).</summary>
    public virtual ICollection<BulkRunPolygon> BulkRunPolygons { get; set; } = new List<BulkRunPolygon>();

    /// <summary>Many-to-many with tblBulkRunSchedule via the tblRouteSchedule junction
    /// (RouteId, ScheduleId). Replaces the legacy 1:1 ScheduleId pointer.</summary>
    public virtual ICollection<TblBulkRunSchedule> Schedules { get; set; } = new List<TblBulkRunSchedule>();
}
