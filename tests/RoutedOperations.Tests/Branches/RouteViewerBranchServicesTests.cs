using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Tests.Services.RouteViewer;

namespace RoutedOperations.Tests.Branches;

// Route Viewer services under a branch-limited caller. Only the paths that don't need a stored procedure can run here:
// the courier pickers (EF), the run-level writes (denied before the procedure is reached), and the by-id reads that return
// empty / null when the job or client is outside the caller's branches.
public class RouteViewerBranchServicesTests
{
    private const int Sydney = 1;
    private const int Melbourne = 2;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private readonly DbContextOptions<DespatchContext> _options = RouteViewerTestHarness.NewOptions();

    private IDbContextFactory<DynamicDespatchDbContext> Factory() => RouteViewerTestHarness.Factory(_options);

    private async Task Seed(params object[] rows)
    {
        await using var context = RouteViewerTestHarness.Context(_options);
        context.AddRange(rows);
        await context.SaveChangesAsync(Ct);
    }

    private BranchScopeGuard Melbourne_Guard()
    {
        var resolver = Substitute.For<IBranchScopeResolver>();
        resolver.Resolve().Returns(BranchScope.Restricted([Melbourne]));
        return new BranchScopeGuard(resolver, Factory());
    }

    private static INpScopeResolver Admin()
    {
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        return resolver;
    }

    private Task World() => Seed(
        new TblBranch { BranchId = Sydney, IsDefault = true, Active = true, SiteId = 43 },
        new TblBranch { BranchId = Melbourne, IsDefault = false, Active = true, SiteId = 44 },
        new TucClient { UcclId = 10, BranchId = Sydney, ClientTypeId = 2 },
        new TucClient { UcclId = 20, BranchId = Melbourne, ClientTypeId = 2 },
        new TucCourier { UccrId = 100, UccrName = "Syd", UccrSurname = "Driver", Code = "S1", Active = true, BranchId = Sydney },
        new TucCourier { UccrId = 200, UccrName = "Mel", UccrSurname = "Driver", Code = "M1", Active = true, BranchId = Melbourne },
        new TucCourier { UccrId = 300, UccrName = "Def", UccrSurname = "Driver", Code = "D1", Active = true, BranchId = null },
        new TucJob { UcjbId = 1, UcjbNumber = "SYD1", UcjbClientId = 10 },
        new TucJob { UcjbId = 2, UcjbNumber = "MEL1", UcjbClientId = 20 });

    private RouteViewerAssignmentService Assignment(IBranchScopeGuard branch) =>
        new(Factory(), Admin(), Substitute.For<INpScopeGuard>(), branch, NullLogger<RouteViewerAssignmentService>.Instance);

    // ---- couriers a branch-limited user can pick ----

    [Fact]
    public async Task AssignableCouriers_AreOnlyTheCallersBranchCouriers()
    {
        await World();

        var response = await Assignment(Melbourne_Guard()).GetAssignableTargetsAsync(2);

        Assert.Equal(new[] { 200 }, response.Couriers.Select(c => c.Id).ToArray());
    }

    [Fact]
    public async Task CourierSearch_IsNarrowedInSql_BeforeTheLimit()
    {
        await World();

        var result = await Assignment(Melbourne_Guard()).SearchCouriersAsync(2, null, 1);   // a limit of 1 must still find Melbourne's courier

        Assert.Equal(new[] { 200 }, result.Select(c => c.Id).ToArray());
    }

    // ---- run-level writes ----

    [Fact]
    public async Task RunWrites_AreDeniedForARunOutsideTheCallersBranches_BeforeTheProcedureIsReached()
    {
        await World();
        await Seed(new TblBulkRun { Id = 7, CourierId = 100 });   // Sydney's courier, no jobs
        var svc = Assignment(Melbourne_Guard());

        await Assert.ThrowsAsync<BranchScopeException>(() => svc.PreAssignRunAsync(7, "S1", "M1"));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.UnAssignRunAsync(7, "S1"));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.TransferRunAsync(7, "S1", "M1"));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.ReleaseRunAsync(7, "S1"));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.TransferOriginalRunOrderAsync(7, "M1"));
    }

    [Fact]
    public async Task RunWrites_GoAheadForARunWhoseCourierIsTheirs()
    {
        await World();
        await Seed(new TblBulkRun { Id = 8, CourierId = 200 });
        var svc = Assignment(Melbourne_Guard());

        // The guard lets it through; InMemory then can't execute the stored procedure, which is a different exception.
        var ex = await Record.ExceptionAsync(() => svc.ReleaseRunAsync(8, "M1"));

        Assert.NotNull(ex);
        Assert.IsNotType<BranchScopeException>(ex);
    }

    // ---- by-id reads ----

    [Fact]
    public async Task CourierPosition_IsNullForAJobOutsideTheCallersBranches()
    {
        await World();
        var svc = new RouteViewerCourierService(Factory(), Admin(), Melbourne_Guard(), NullLogger<RouteViewerCourierService>.Instance);

        Assert.Null(await svc.GetCourierPositionAsync(1));   // a Sydney job
    }

    [Fact]
    public async Task CourierRoute_IsEmptyForACourierOutsideTheCallersBranches_OrUnknown()
    {
        await World();
        var svc = new RouteViewerCourierService(Factory(), Admin(), Melbourne_Guard(), NullLogger<RouteViewerCourierService>.Instance);

        Assert.Empty(await svc.GetCourierRouteAsync("S1", DateTime.Today, DateTime.Today));
        Assert.Empty(await svc.GetCourierRouteAsync("NOPE", DateTime.Today, DateTime.Today));
    }

    [Fact]
    public async Task DirectLink_IsDeclinedForAClientOutsideTheCallersBranches()
    {
        await World();
        var svc = new RouteViewerEventService(Factory(), Admin(), Melbourne_Guard(), NullLogger<RouteViewerEventService>.Instance);

        var response = await svc.GenerateDirectLinkAsync(5, 10);   // a Sydney client

        Assert.Equal("Link Declined", response.Url);
    }

    [Fact]
    public async Task ScanReads_ForAShipmentOutsideTheCallersBranches_ReturnNothing()
    {
        await World();
        var svc = new RouteViewerScanService(Factory(), Admin(), Substitute.For<INpScopeGuard>(), Melbourne_Guard(), NullLogger<RouteViewerScanService>.Instance);

        Assert.Null(await svc.GetRoutedShipmentDetailAsync(1, DateTime.Today));
        Assert.Empty(await svc.GetItemProgressAsync(1));
        Assert.Empty(await svc.GetScanDetailAsync(DateTime.Today, null, 1));
    }
}
