// tblClearListArea: a driver location list (the "Clear-List Area" a US or AU
// ZoneGroup points at through ZoneGroup.ClearListAreaId). READ ONLY here; the
// lists are maintained in the configurator's Settings. Only the columns the
// zone group picker needs are mapped. Column shapes checked 12 Nov on
// Despatch_Urgent_Staging (local) and DFRNT_SEED_CR: all four NOT NULL,
// ClearListAreaID is the identity.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tblClearListArea")]
public class TblClearListArea
{
    [Key]
    [Column("ClearListAreaID")]
    public int ClearListAreaId { get; set; }

    [Column("Code")]
    public string Code { get; set; }

    [Column("Name")]
    public string Name { get; set; }

    [Column("Order")]
    public int Order { get; set; }
}
