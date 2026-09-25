// Ported from the Configurator scaffold. Dispatch_RouteRoster is the per-day
// duty roster attached to a Route - one row per (Route, RosterDate or
// DayOfWeek, TargetType, TargetId) combination. IsActive=0 acts as
// soft-delete; the unique filtered indexes on the table prevent conflicting
// active rosters for the same day/dow.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("Dispatch_RouteRoster")]
public partial class DispatchRouteRoster
{
    [Key]
    public int RouteRosterId { get; set; }

    public int RouteId { get; set; }

    public int? CourierId { get; set; }

    /// <summary>Specific date this roster applies to. Mutually exclusive with DayOfWeek.</summary>
    [Column(TypeName = "datetime")]
    public DateTime? RosterDate { get; set; }

    /// <summary>ISO day-of-week 1-7 (Mon..Sun). Mutually exclusive with RosterDate.</summary>
    public byte? DayOfWeek { get; set; }

    public bool IsActive { get; set; }

    [Column(TypeName = "datetime")]
    public DateTime CreatedAt { get; set; }

    [Required]
    [MaxLength(100)]
    public string CreatedBy { get; set; }

    /// <summary>Polymorphic target type: 1 = Courier, 2 = Agent, 3 = Network Partner. Mirrors Route.DefaultTargetType.</summary>
    public byte? TargetType { get; set; }

    public int? AgentId { get; set; }

    [ForeignKey(nameof(RouteId))]
    public virtual Route Route { get; set; }

    [ForeignKey(nameof(CourierId))]
    public virtual TucCourier Courier { get; set; }

    [ForeignKey(nameof(AgentId))]
    public virtual TucAgent Agent { get; set; }
}
