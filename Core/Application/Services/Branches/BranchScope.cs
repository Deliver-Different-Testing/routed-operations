// Branch visibility scope for the current request (Branches programme B2;
// master spec BRANCHES-SCOPE-2026-10-28 section 4, Kerran start doc section 6).
//
// - IsRestricted = false: the caller sees every row. That is every tenant
//   staff user with no branches (everyone today, and the super users), and
//   every caller the branch rule does not apply to: network partners and
//   customers (scoped by the NP rules instead), couriers, and system work with
//   no HttpContext (nightly Lambda, auto-dispatch, Accounts batches, webhooks).
// - IsRestricted = true: tenant staff (ClientTypeId 4 or 5) whose Hub login
//   carried a non-empty BranchIds claim. They see only rows in those branches
//   (BranchPredicates). An empty BranchIds list while restricted is the
//   fail-closed state for a malformed claim: no branch rows at all.

namespace RoutedOperations.Core.Application.Services.Branches;

public sealed record BranchScope(bool IsRestricted, IReadOnlyList<int> BranchIds)
{
    public static readonly BranchScope Unrestricted = new(false, Array.Empty<int>());

    public static BranchScope Restricted(IEnumerable<int> branchIds) =>
        new(true, branchIds.Distinct().ToArray());
}
