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

    /// <summary>FK into tblBulkRunSchedule (representative id of the schedule group).</summary>
    public int? ScheduleId { get; set; }

    [ForeignKey(nameof(DefaultCourierId))]
    public virtual TucCourier DefaultCourier { get; set; }

    [ForeignKey(nameof(DefaultAgentId))]
    public virtual TucAgent DefaultAgent { get; set; }

    public virtual ICollection<DispatchRouteRoster> DispatchRouteRosters { get; set; } = new List<DispatchRouteRoster>();

    /// <summary>Many-to-many with ZipPolygon via the RouteZipcodes junction (RouteId, ZipPolygonId).</summary>
    public virtual ICollection<ZipPolygon> ZipPolygons { get; set; } = new List<ZipPolygon>();
}
