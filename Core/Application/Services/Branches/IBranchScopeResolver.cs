// Resolves the caller's branch scope from the Hub BranchIds claim, cached per
// request on HttpContext.Items (same pattern as INpScopeResolver).

namespace RoutedOperations.Core.Application.Services.Branches;

public interface IBranchScopeResolver
{
    /// <summary>
    /// Resolution:
    ///   1. No HttpContext (system / background work) -> unrestricted.
    ///   2. Not tenant staff (CallerLane.IsStaff false: customer, courier,
    ///      missing ClientTypeId) or a network partner -> unrestricted here;
    ///      those callers are scoped by the NP / customer rules instead.
    ///   3. BranchIds claim missing or blank -> unrestricted (no branches =
    ///      sees everything, master spec decision 5).
    ///   4. BranchIds = comma-separated ints -> restricted to those ids.
    ///      Any token that is not an int -> restricted to NO branches (fail
    ///      closed; never widen on a malformed claim).
    /// </summary>
    BranchScope Resolve();
}
