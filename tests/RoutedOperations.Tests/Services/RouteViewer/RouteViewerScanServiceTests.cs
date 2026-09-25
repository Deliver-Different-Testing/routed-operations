// RouteViewerScanService wraps 6 scan-related SPs. Bulk mode is admin-only;
// routed / detail / progress branches allow NP with agent id but block
// degenerate NP. RemoveMissingScanJobs returns false for NP.
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerScanServiceTests
{
    private static (RouteViewerScanService sut, INpScopeResolver resolver) NewSvc(NpScope scope)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        var sut = new RouteViewerScanService(factory, resolver,
            NullLogger<RouteViewerScanService>.Instance);
        return (sut, resolver);
    }

    [Fact]
    public async Task GetBulkScanJobsAsync_Np_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, 42));
        var result = await sut.GetBulkScanJobsAsync(new RoutedOperations.Core.Application.Dtos.RouteViewer.BulkRunListRequest());
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetBulkScanJobsAsync_Admin_HitsSp()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetBulkScanJobsAsync(new RoutedOperations.Core.Application.Dtos.RouteViewer.BulkRunListRequest()));
    }

    [Fact]
    public async Task GetRoutedScanJobsAsync_NpDegenerate_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetRoutedScanJobsAsync(new RoutedOperations.Core.Application.Dtos.RouteViewer.BulkRunListRequest());
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetRoutedScanJobsAsync_Admin_HitsSp()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetRoutedScanJobsAsync(new RoutedOperations.Core.Application.Dtos.RouteViewer.BulkRunListRequest()));
    }

    [Fact]
    public async Task GetRoutedShipmentDetailAsync_NpDegenerate_ReturnsNull()
    {
        var (sut, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetRoutedShipmentDetailAsync(1, DateTime.Today);
        Assert.Null(result);
    }

    [Fact]
    public async Task GetRoutedShipmentDetailAsync_Admin_HitsSp()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetRoutedShipmentDetailAsync(1, DateTime.Today));
    }

    [Fact]
    public async Task GetScanDetailAsync_NpDegenerate_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetScanDetailAsync(DateTime.Today, "scan", null);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetScanDetailAsync_Admin_HitsSp()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetScanDetailAsync(DateTime.Today, "scan", null));
    }

    [Fact]
    public async Task GetItemProgressAsync_NpDegenerate_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetItemProgressAsync(5);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetItemProgressAsync_Admin_HitsSp()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetItemProgressAsync(5));
    }

    [Fact]
    public async Task RemoveMissingScanJobsAsync_Np_ReturnsFalse()
    {
        var (sut, _) = NewSvc(new NpScope(false, 42));
        var result = await sut.RemoveMissingScanJobsAsync(new RemoveMissingScanRequest());
        Assert.False(result);
    }

    [Fact]
    public async Task RemoveMissingScanJobsAsync_Admin_HitsSp()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.RemoveMissingScanJobsAsync(new RemoveMissingScanRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public void RemoveMissingScanRequest_DefaultsAreNull()
    {
        var req = new RemoveMissingScanRequest();
        Assert.Null(req.RunDate);
        Assert.Null(req.ClientId);
        Assert.Null(req.ClientIds);
        Assert.Null(req.RegionIds);
        Assert.Null(req.SpeedIds);
    }
}
