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
        var (sut, resolver, _) = NewSvcWithGuard(scope);
        return (sut, resolver);
    }

    private static (RouteViewerScanService sut, INpScopeResolver resolver, INpScopeGuard guard) NewSvcWithGuard(NpScope scope)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        var guard = Substitute.For<INpScopeGuard>();
        var sut = new RouteViewerScanService(factory, resolver, guard,
            NullLogger<RouteViewerScanService>.Instance);
        return (sut, resolver, guard);
    }

    // ---- NP leaks K3 / K4 / K5 (2026-11-13) ----

    [Fact]
    public async Task GetRoutedShipmentDetailAsync_Np_ForeignRoot_Throws()
    {
        var (sut, _, guard) = NewSvcWithGuard(new NpScope(false, 42));
        guard.EnsureTucJobInScopeAsync(99).Returns<Task>(_ => throw new NpLabelScopeException("x"));
        await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.GetRoutedShipmentDetailAsync(99, null));
    }

    [Fact]
    public async Task GetItemProgressAsync_Np_ForeignRoot_Throws()
    {
        var (sut, _, guard) = NewSvcWithGuard(new NpScope(false, 42));
        guard.EnsureTucJobInScopeAsync(99).Returns<Task>(_ => throw new NpLabelScopeException("x"));
        await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.GetItemProgressAsync(99));
    }

    [Fact]
    public async Task GetScanDetailAsync_Np_ForeignRoot_Throws()
    {
        var (sut, _, guard) = NewSvcWithGuard(new NpScope(false, 42));
        guard.EnsureTucJobInScopeAsync(99).Returns<Task>(_ => throw new NpLabelScopeException("x"));
        await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.GetScanDetailAsync(null, null, 99));
    }

    [Fact]
    public async Task GetScanDetailAsync_Np_ForeignBulkJob_Throws()
    {
        var (sut, _, guard) = NewSvcWithGuard(new NpScope(false, 42));
        guard.EnsureBulkJobInScopeAsync(5).Returns<Task>(_ => throw new NpLabelScopeException("x"));
        await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.GetScanDetailAsync(null, null, null, 5));
    }

    [Theory]
    [InlineData("E259HAM", "E259HAM")]
    [InlineData("E259HAMLH1", "E259HAM")]
    [InlineData("E259HAMDEL", "E259HAM")]
    [InlineData("e259hamdel", "e259ham")]
    [InlineData("E259HAM-1", "E259HAM-1")]
    public void BaseJobNumber_MatchesSqlFunction(string scan, string expected)
        => Assert.Equal(expected, RouteViewerScanService.BaseJobNumber(scan));

    [Fact]
    public async Task GetScanDetailAsync_Np_UnknownScan_Throws()
    {
        // Partial prefixes / item barcodes do not resolve to an exact job
        // number and would reach other clients' scans through the SP LIKE.
        var (sut, _, _) = NewSvcWithGuard(new NpScope(false, 42));
        await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.GetScanDetailAsync(null, "E2", null));
    }

    [Fact]
    public async Task GetScanDetailAsync_Np_NoRootNoScan_ReturnsEmptyWithoutSp()
    {
        // A blank scan would reach the SP as LIKE '%' over every client's
        // bulk scans; NP gets nothing instead.
        var (sut, _, guard) = NewSvcWithGuard(new NpScope(false, 42));
        Assert.Empty(await sut.GetScanDetailAsync(null, "  ", null));
        await guard.DidNotReceive().EnsureTucJobInScopeAsync(Arg.Any<int>());
    }

    [Fact]
    public async Task GetItemProgressAsync_Admin_StillCallsGuard()
    {
        // Admin path still calls the guard (which is a no-op for admin
        // scope in the real implementation) before the SP.
        var (sut, _, guard) = NewSvcWithGuard(new NpScope(true, null));
        await Record.ExceptionAsync(() => sut.GetItemProgressAsync(7));
        await guard.Received(1).EnsureTucJobInScopeAsync(7);
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
