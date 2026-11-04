// Column pre-exists on tucJobType on both tenants (checked 2026-11-04 on local
// Despatch_Urgent_Staging and DFRNT_SEED_CR: bit NULL). Bulk import routes truck
// speeds on it.
#nullable disable
namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucJobType
{
    public bool? TruckJobEntry { get; set; }
}
