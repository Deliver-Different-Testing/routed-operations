// Branches B2: the courier pickers on the Assign Route dialog apply the branch
// filter in SQL, before the Take, so a branch-limited user's page is correct.
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Tests.Services.RouteViewer;

namespace RoutedOperations.Tests.Branches;

public class RouteViewerAssignmentServiceBranchTests
{
    private static async Task<RouteViewerAssignmentService> NewSvc(BranchRowFilter filter, int couriers)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        await using (var seed = RouteViewerTestHarness.Context(opts))
        {
            for (var i = 1; i <= couriers; i++)
                seed.TucCouriers.Add(new TucCourier { UccrId = i, UccrName = "N" + i, UccrSurname = "S", Code = "C" + i, Active = true });
            await seed.SaveChangesAsync();
        }

        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        return new RouteViewerAssignmentService(RouteViewerTestHarness.Factory(opts), resolver,
            Substitute.For<INpScopeGuard>(), BranchTestDoubles.Restricted(filter),
            NullLogger<RouteViewerAssignmentService>.Instance);
    }

    [Fact]
    public async Task SearchCouriers_Restricted_OnlyBranchCouriers()
    {
        var sut = await NewSvc(BranchRowFilter.Restricted(Array.Empty<int>(), new[] { 2, 4 }, false), couriers: 5);

        var result = await sut.SearchCouriersAsync(1, null, 50);

        Assert.Equal(new[] { 2, 4 }, result.Select(r => r.Id).OrderBy(i => i));
    }

    [Fact]
    public async Task AssignableTargets_Restricted_OnlyBranchCouriers()
    {
        var sut = await NewSvc(BranchRowFilter.Restricted(Array.Empty<int>(), new[] { 3 }, false), couriers: 5);

        var result = await sut.GetAssignableTargetsAsync(1);

        Assert.Equal(new[] { 3 }, result.Couriers.Select(r => r.Id));
    }

    [Fact]
    public async Task SearchCouriers_Unrestricted_Unchanged()
    {
        var sut = await NewSvc(BranchRowFilter.Unrestricted, couriers: 5);

        var result = await sut.SearchCouriersAsync(1, null, 50);

        Assert.Equal(5, result.Count);
    }
}
