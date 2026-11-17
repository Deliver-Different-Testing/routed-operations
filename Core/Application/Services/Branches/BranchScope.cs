// Branch visibility scope for the current request (Branches programme, B2; master spec section 4, start doc section 6).
//
// IsRestricted = false: the caller sees every row. That is tenant staff with no branches (everyone today, and the super
// users) and every caller the branch rule does not apply to: network partners (scoped by the NP rules), DF Admin,
// customers, couriers, and system work with no HttpContext.
// IsRestricted = true: tenant staff whose Hub login carried a non-empty BranchIds claim. They see only rows in those
// branches. An EMPTY BranchIds list while restricted is the fail-closed state for a malformed claim: no branch rows at
// all (apart from the house accounts every staff member shares).
namespace RoutedOperations.Core.Application.Services.Branches;

public sealed record BranchScope(bool IsRestricted, IReadOnlyList<int> BranchIds)
{
    public static readonly BranchScope Unrestricted = new(false, []);

    public static BranchScope Restricted(IEnumerable<int> branchIds) => new(true, [.. branchIds.Distinct()]);
}
