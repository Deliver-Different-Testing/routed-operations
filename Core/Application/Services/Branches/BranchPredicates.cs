// The branch visibility rule, written once (master spec section 4):
//
//   client C visible  <=> C.BranchId in user's branches
//                         OR (C.BranchId IS NULL AND the default branch is one of them)
//                         OR C is the tenant's own / an internal client (always visible)
//   courier R visible <=> R.BranchId in user's branches
//                         OR (R.BranchId IS NULL AND the default branch is one of them)  [D1]
//   job J visible     <=> J's client visible
//                         OR (option B switched on AND J's courier visible)          [4.1]
//
// The client and courier halves are EF expressions so the guard and any LINQ
// list query share them. The job half is BranchRowFilter.IsJobVisible, the
// only place the option A / B decision is taken.
using System.Linq.Expressions;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.Branches;

public static class BranchPredicates
{
    /// <summary>
    /// tucClient.ClientTypeId values every branch-limited staff user still sees:
    /// 4 = Tenant (the tenant's own client), 5 = DF Admin, 1 = Internal.
    /// Master spec Q12 recommended default ("tenant's own client and internal
    /// clients visible to all tenant staff"). Keyed on ClientTypeId, never on
    /// the ucclInternal billing flag (Steve 2026-10-08).
    /// </summary>
    public static readonly int[] AlwaysVisibleClientTypeIds = { 1, 4, 5 };

    public static Expression<Func<TucClient, bool>> ClientVisible(int[] branchIds, bool defaultBranchInScope) =>
        c => (c.BranchId != null && branchIds.Contains(c.BranchId.Value))
             || (c.BranchId == null && defaultBranchInScope)
             || AlwaysVisibleClientTypeIds.Contains(c.ClientTypeId);

    public static Expression<Func<TucCourier, bool>> CourierVisible(int[] branchIds, bool defaultBranchInScope) =>
        r => (r.BranchId != null && branchIds.Contains(r.BranchId.Value))
             || (r.BranchId == null && defaultBranchInScope);
}
