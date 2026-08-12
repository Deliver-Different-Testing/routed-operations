// tucJobTypeGrouping: names the parent group a speed rolls up under
// (SameCourier / Overnight / Linehaul / Flight / US Flight / Other).
// The Recurring Routes Linehaul port keys off GroupingName.Contains("flight")
// to decide whether a speed is a valid choice for a Flight-mode run.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tucJobTypeGrouping")]
public class TucJobTypeGrouping
{
    [Key]
    [Column("GroupingID")]
    public int GroupingId { get; set; }

    [Column("GroupingName")]
    public string GroupingName { get; set; }
}
