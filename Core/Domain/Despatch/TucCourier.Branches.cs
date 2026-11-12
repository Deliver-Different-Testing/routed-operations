// Branches programme (B2) partial of TucCourier.
//
// BranchId: the courier's home branch (tucCourier.BranchId INT NULL, B0
// script 2). NULL means the tenant's default branch (Kerran start doc D1).
//
// DEPLOY DEPENDENCY: mapped column; B0 script 2 must be on every tenant DB
// before this ships (see TucClient.Branches.cs).
#nullable disable

using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucCourier
{
    [Column("BranchId")]
    public int? BranchId { get; set; }
}
