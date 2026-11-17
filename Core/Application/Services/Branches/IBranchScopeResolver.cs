namespace RoutedOperations.Core.Application.Services.Branches;

/// <summary>
/// Resolves the caller's branch scope from the Hub <c>BranchIds</c> claim, cached for the request. Synchronous: the claim
/// is the whole input (unlike the NP resolver there is no database fallback). Branch changes reach a user at their next
/// sign-in or token refresh.
/// </summary>
public interface IBranchScopeResolver
{
    BranchScope Resolve();
}
