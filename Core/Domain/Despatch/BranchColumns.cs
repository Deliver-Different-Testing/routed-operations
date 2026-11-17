// Branches programme (B2). tblBranch and the BranchId columns come from dbmigrationsv2 (AddBranches, AddBranchSiteId,
// BranchFleetColumnAndBackfill). Hand-written partials so a re-scaffold of the context cannot drop them.
//
// DEPLOY DEPENDENCY: BranchId and ClientTypeId are mapped columns, so every full-entity load of TucClient / TucCourier
// selects them. The branch migrations must be on every tenant database before this ships, or those loads fail with
// "Invalid column name 'BranchId'".
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>A tenant branch. Read only here (branches are maintained in Settings). Queried only for branch-limited users.</summary>
[Table("tblBranch")]
public class TblBranch
{
    [Key]
    public int BranchId { get; set; }

    public bool IsDefault { get; set; }

    public bool Active { get; set; }

    /// <summary>The tblSite this branch maps to; a leg whose pickup or delivery suburb is on it belongs to the branch.</summary>
    public int? SiteId { get; set; }
}

public partial class TucClient
{
    /// <summary>The client's branch. NULL = the tenant's default branch.</summary>
    [Column("BranchId")]
    public int? BranchId { get; set; }

    /// <summary>1 internal, 2 customer, 3 network partner, 4 tenant, 5 DF Admin. Used to keep house accounts visible.</summary>
    [Column("ClientTypeId")]
    public int ClientTypeId { get; set; }
}

public partial class TucCourier
{
    /// <summary>The courier's home branch. NULL = the tenant's default branch (D1).</summary>
    [Column("BranchId")]
    public int? BranchId { get; set; }
}
