using RoutedOperations.Core.Application.Services.Branches;

namespace RoutedOperations.Tests.Branches;

/// <summary>IBranchScopeGuard stand-ins for service tests that are not about
/// branches: every Ensure* passes and GetRowFilterAsync is unrestricted.</summary>
internal static class BranchTestDoubles
{
    public static IBranchScopeGuard Unrestricted()
    {
        var guard = Substitute.For<IBranchScopeGuard>();
        guard.GetRowFilterAsync().Returns(BranchRowFilter.Unrestricted);
        return guard;
    }

    public static IBranchScopeGuard Restricted(BranchRowFilter filter)
    {
        var guard = Substitute.For<IBranchScopeGuard>();
        guard.GetRowFilterAsync().Returns(filter);
        return guard;
    }
}
