// Route Viewer partial extending TucCourier with NpAgentId (for the
// NP-scoped courier list on the Assign Route dialog).
#nullable disable

using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucCourier
{
    [Column("NpAgentID")]
    public int? NpAgentId { get; set; }
}
