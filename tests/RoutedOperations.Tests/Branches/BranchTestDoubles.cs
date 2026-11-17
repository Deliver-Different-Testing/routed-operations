using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Branches;

internal static class BranchTestDoubles
{
    /// <summary>An <see cref="IBranchScopeGuard"/> for an unrestricted caller (no branches), which is how every existing
    /// Route Viewer test runs: every list helper short-circuits and a courier query comes back unchanged.</summary>
    internal static IBranchScopeGuard Unrestricted()
    {
        var guard = Substitute.For<IBranchScopeGuard>();
        guard.IsRestricted.Returns(false);
        guard.WhereCourierVisibleAsync(Arg.Any<IQueryable<TucCourier>>())
            .Returns(call => Task.FromResult(call.Arg<IQueryable<TucCourier>>()));
        guard.WhereClientVisibleAsync(Arg.Any<IQueryable<TucClient>>())
            .Returns(call => Task.FromResult(call.Arg<IQueryable<TucClient>>()));
        return guard;
    }
}
