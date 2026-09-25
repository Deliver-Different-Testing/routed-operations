// RouteViewerRouteTransferService covers the two-step Transfer Route dialog.
// Step 1 (GetTransferContextAsync) + Step 2 (GetTransferPreviewAsync) are
// EF-only so are exercisable under InMemory. Step 3 (TransferAsync) invokes
// RVW_stpTransferRouteForFamilies via SqlQueryRaw which InMemory cannot run;
// tests cover the scope-guard invariants around it.
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerRouteTransferServiceTests
{
    private static (RouteViewerRouteTransferService sut, DynamicDespatchDbContext seed, INpScopeGuard guard)
        NewSvc()
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var seed = RouteViewerTestHarness.Context(opts);
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var guard = Substitute.For<INpScopeGuard>();
        var sut = new RouteViewerRouteTransferService(factory, resolver, guard,
            NullLogger<RouteViewerRouteTransferService>.Instance);
        return (sut, seed, guard);
    }

    [Fact]
    public async Task GetTransferContextAsync_EmptyDb_ReturnsEmptyRoutes()
    {
        var (sut, _, _) = NewSvc();
        var resp = await sut.GetTransferContextAsync(null);
        Assert.Empty(resp.Routes);
        Assert.Null(resp.CurrentRouteId);
    }

    [Fact]
    public async Task GetTransferContextAsync_ReturnsOnlyActiveRoutes()
    {
        var (sut, seed, _) = NewSvc();
        seed.Routes.Add(new Route { RouteId = 1, Name = "OnRoute", Area = "A", Active = true, CreatedBy = "sys", CreatedAt = DateTime.UtcNow });
        seed.Routes.Add(new Route { RouteId = 2, Name = "OffRoute", Area = "A", Active = false, CreatedBy = "sys", CreatedAt = DateTime.UtcNow });
        await seed.SaveChangesAsync();

        var resp = await sut.GetTransferContextAsync(null);

        Assert.Single(resp.Routes);
        Assert.Equal("OnRoute", resp.Routes[0].Name);
    }

    [Fact]
    public async Task GetTransferContextAsync_OrdersRoutesByName()
    {
        var (sut, seed, _) = NewSvc();
        seed.Routes.Add(new Route { RouteId = 1, Name = "Zeta", Area = "A", Active = true, CreatedBy = "sys", CreatedAt = DateTime.UtcNow });
        seed.Routes.Add(new Route { RouteId = 2, Name = "Alpha", Area = "A", Active = true, CreatedBy = "sys", CreatedAt = DateTime.UtcNow });
        await seed.SaveChangesAsync();

        var resp = await sut.GetTransferContextAsync(null);

        Assert.Equal("Alpha", resp.Routes[0].Name);
        Assert.Equal("Zeta", resp.Routes[1].Name);
    }

    [Fact]
    public async Task GetTransferContextAsync_WithAnchor_ResolvesCurrentRouteBadge()
    {
        var (sut, seed, guard) = NewSvc();
        seed.Routes.Add(new Route { RouteId = 5, Name = "R5", Area = "A", Active = true, CreatedBy = "sys", CreatedAt = DateTime.UtcNow });
        seed.TucJobs.Add(new TucJob { UcjbId = 100, UcjbNumber = "J1", RouteId = 5 });
        await seed.SaveChangesAsync();

        var resp = await sut.GetTransferContextAsync(100);

        Assert.Equal(5, resp.CurrentRouteId);
        Assert.Equal("R5", resp.CurrentRouteName);
        await guard.Received(1).EnsureTucJobInScopeAsync(100);
    }

    [Fact]
    public async Task GetTransferContextAsync_AnchorWithNoRoute_LeavesBadgeNull()
    {
        var (sut, seed, _) = NewSvc();
        seed.TucJobs.Add(new TucJob { UcjbId = 100, UcjbNumber = "J1", RouteId = null });
        await seed.SaveChangesAsync();

        var resp = await sut.GetTransferContextAsync(100);

        Assert.Null(resp.CurrentRouteId);
        Assert.Null(resp.CurrentRouteName);
    }

    [Fact]
    public async Task GetTransferPreviewAsync_EmptyCsv_ReturnsEmpty()
    {
        var (sut, _, _) = NewSvc();
        var resp = await sut.GetTransferPreviewAsync("");
        Assert.Empty(resp.Jobs);
    }

    [Fact]
    public async Task GetTransferPreviewAsync_ReturnsPerAnchorRowsWithCurrentRouteName()
    {
        var (sut, seed, guard) = NewSvc();
        seed.Routes.Add(new Route { RouteId = 5, Name = "R5", Area = "AK", Active = true, CreatedBy = "sys", CreatedAt = DateTime.UtcNow });
        seed.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "J10", UcjbFromAddr = "1 Main", RouteId = 5 });
        seed.TucJobs.Add(new TucJob { UcjbId = 11, UcjbNumber = "J11", UcjbFromAddr = "2 Main", RouteId = null });
        await seed.SaveChangesAsync();

        var resp = await sut.GetTransferPreviewAsync("10,11");

        Assert.Equal(2, resp.Jobs.Count);
        Assert.Equal("J10", resp.Jobs.First(r => r.JobId == 10).JobNumber);
        Assert.Equal("R5", resp.Jobs.First(r => r.JobId == 10).CurrentRouteName);
        Assert.Null(resp.Jobs.First(r => r.JobId == 11).CurrentRouteName);
        await guard.Received(1).EnsureTucJobInScopeAsync(10);
        await guard.Received(1).EnsureTucJobInScopeAsync(11);
    }

    [Fact]
    public async Task GetTransferPreviewAsync_IgnoresGarbageIds()
    {
        var (sut, seed, _) = NewSvc();
        seed.TucJobs.Add(new TucJob { UcjbId = 42, UcjbNumber = "J42" });
        await seed.SaveChangesAsync();

        var resp = await sut.GetTransferPreviewAsync("abc,,-1,42,0");

        Assert.Single(resp.Jobs);
        Assert.Equal(42, resp.Jobs[0].JobId);
    }

    [Fact]
    public async Task GetTransferPreviewAsync_NullCsv_ReturnsEmpty()
    {
        var (sut, _, _) = NewSvc();
        var resp = await sut.GetTransferPreviewAsync(null!);
        Assert.Empty(resp.Jobs);
    }

    [Fact]
    public async Task TransferAsync_GuardsEveryJobAndRoute()
    {
        // SP call will throw under InMemory but the guard calls must
        // fire first so we can capture them.
        var (sut, seed, guard) = NewSvc();
        seed.Routes.Add(new Route { RouteId = 5, Name = "R5", Area = "A", Active = true, CreatedBy = "sys", CreatedAt = DateTime.UtcNow });
        await seed.SaveChangesAsync();

        await Assert.ThrowsAnyAsync<Exception>(() => sut.TransferAsync(new TransferRouteRequest
        {
            JobIds = new List<int> { 1, 2 },
            NewRouteId = 5,
        }));

        await guard.Received(1).EnsureTucJobInScopeAsync(1);
        await guard.Received(1).EnsureTucJobInScopeAsync(2);
        await guard.Received(1).EnsureRouteInScopeAsync(5);
    }
}
