// Branches programme (B2) partial of TucClient.
//
// BranchId: the client's branch (tucClient.BranchId INT NULL, B0 script 2).
// NULL means the tenant's default branch. A job's branch is its client's
// branch (master spec decision 3).
//
// ClientTypeId: tucClient.ClientTypeId (NOT NULL, default 2), added by
// 20260513123935_NPMarketplaceAndQuotes. Used only to keep the tenant's own
// and internal client rows visible to every branch-limited staff user
// (BranchPredicates.AlwaysVisibleClientTypeIds).
//
// DEPLOY DEPENDENCY: BranchId is a mapped column, so every full-entity load of
// TucClient selects it. B0 script 2 must be applied on every tenant DB
// (staging and prod) before this code ships, or those loads fail with
// "Invalid column name 'BranchId'" (same failure shape as the removed
// TucJob.BulkJobID, see TucJob.RouteViewer.cs).
#nullable disable

using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucClient
{
    [Column("BranchId")]
    public int? BranchId { get; set; }

    [Column("ClientTypeId")]
    public int ClientTypeId { get; set; }
}
