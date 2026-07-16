// The Despatch DB's speed/service-level lookup table. RunBuilder reads only two
// columns from it - ucjtID (speed number) and ucjtName - for the speed picker.
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tucJobType")]
public partial class TucJobType
{
    [Column("ucjtID")]
    public int UcjtId { get; set; }

    [Column("ucjtName")]
    public string UcjtName { get; set; }
}
