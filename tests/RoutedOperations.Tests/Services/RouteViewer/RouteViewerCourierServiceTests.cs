// RouteViewerCourierService wraps 5 SPs. All 5 short-circuit to empty for
// NP sessions (Section 3.4). SP-invoking branches throw under InMemory;
// tests cover the NP short-circuit branches exhaustively + confirm admin
// invokes the SP.
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerCourierServiceTests
{
    private static RouteViewerCourierService NewSvc(NpScope scope)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        return new RouteViewerCourierService(factory, resolver,
            NullLogger<RouteViewerCourierService>.Instance);
    }

    [Fact]
    public async Task GetActiveCouriersAsync_Np_ReturnsEmpty()
    {
        var sut = NewSvc(new NpScope(false, 42));
        var result = await sut.GetActiveCouriersAsync(DateTime.Today);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetActiveCouriersAsync_Admin_HitsSp()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetActiveCouriersAsync(DateTime.Today));
    }

    [Fact]
    public async Task SearchActiveCouriersAsync_Np_ReturnsEmpty()
    {
        var sut = NewSvc(new NpScope(false, 42));
        var result = await sut.SearchActiveCouriersAsync("ABC");
        Assert.Empty(result);
    }

    [Fact]
    public async Task SearchActiveCouriersAsync_Admin_HitsSp()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.SearchActiveCouriersAsync("A"));
    }

    [Fact]
    public async Task GetCourierPositionAsync_Np_ReturnsNull()
    {
        var sut = NewSvc(new NpScope(false, 42));
        var result = await sut.GetCourierPositionAsync(1);
        Assert.Null(result);
    }

    [Fact]
    public async Task GetCourierPositionAsync_Admin_HitsSp()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetCourierPositionAsync(1));
    }

    [Fact]
    public async Task GetAvailableCourierPositionsAsync_Np_ReturnsEmpty()
    {
        var sut = NewSvc(new NpScope(false, 42));
        var result = await sut.GetAvailableCourierPositionsAsync(1m, 2m, 3m, 4m);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetAvailableCourierPositionsAsync_Admin_HitsSp()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetAvailableCourierPositionsAsync(1m, 2m, 3m, 4m));
    }

    [Fact]
    public async Task GetCourierRouteAsync_Np_ReturnsEmpty()
    {
        var sut = NewSvc(new NpScope(false, 42));
        var result = await sut.GetCourierRouteAsync("ABC", DateTime.Today, DateTime.Today.AddHours(1));
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetCourierRouteAsync_Admin_HitsSp()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetCourierRouteAsync("ABC", DateTime.Today, DateTime.Today.AddHours(1)));
    }
}
