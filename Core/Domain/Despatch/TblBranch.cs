// tblBranch: a tenant's operating branch (Branches programme, B0 schema in
// dbmigrationsv2; master spec BRANCHES-SCOPE-2026-10-28 section 3). Routed Ops
// reads only what the B2 visibility rule needs: which branch is the tenant
// default (a client or courier with a NULL BranchId belongs to it), whether it
// is active, and the site it maps to (suburb -> site -> branch). READ ONLY here; branches are maintained in Settings.
//
// Schema dependency: the table only exists once B0 script 1 has run. Routed Ops
// queries it only for a branch-restricted user (a non-empty BranchIds claim),
// which Hub can only issue after B0 is live, so a tenant without the table is
// never asked for it.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tblBranch")]
public class TblBranch
{
    [Key]
    [Column("BranchId")]
    public int BranchId { get; set; }

    [Column("IsDefault")]
    public bool IsDefault { get; set; }

    [Column("Active")]
    public bool Active { get; set; }

    /// <summary>tblBranch.SiteId (B0 decision 12): the site this branch maps
    /// to. A job leg whose pickup or delivery suburb sits on this site is in
    /// this branch (master spec section 4.1, 12 Nov).</summary>
    [Column("SiteId")]
    public int? SiteId { get; set; }
}
