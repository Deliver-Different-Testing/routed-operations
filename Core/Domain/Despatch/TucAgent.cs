// Trimmed port of the Configurator TucAgent scaffold. Route Builder only
// needs enough of tucAgent to render + assign default targets on a Route -
// name + network-partner flag + id. Configurator holds the full record for
// onboarding / compliance / rate cards; RoutedOperations reads it only.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tucAgents")]
public partial class TucAgent
{
    [Key]
    [Column("UcagID")]
    public int UcagId { get; set; }

    [Column("UcagName")]
    [MaxLength(200)]
    public string UcagName { get; set; }

    /// <summary>true when this agent participates as a Network Partner; Route target type 3.</summary>
    public bool IsNetworkPartner { get; set; }

    public virtual ICollection<Route> Routes { get; set; } = new List<Route>();

    public virtual ICollection<DispatchRouteRoster> DispatchRouteRosters { get; set; } = new List<DispatchRouteRoster>();
}
