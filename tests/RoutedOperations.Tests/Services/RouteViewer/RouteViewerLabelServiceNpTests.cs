// NP scoping on RouteViewerLabelService. Before this file there were no
// label-service tests at all, which is why two gaps survived:
//
//   * GetLineHaulLabelsAsync (Mode 6) never called
//     EnsureBulkLabelFlowSupportedForNpAsync, although both sibling bulk
//     flows open with it and the controller doc comment already claimed
//     "NP blocked".
//   * GetLineHaulManifestCsvAsync proxies a tenant-wide CSV straight to
//     legacy with no row filter of any kind, on the weaker
//     RouteViewer.Read policy.
//
// Each guard runs before any DB or proxy work, so these assert on the
// NpLabelScopeException without needing SQL Server or the legacy backend.
// See NP-PAY-PART4-TODO.md T7/T8.
using DeliverDifferent.AlertLabel.Data.Services;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerLabelServiceNpTests
{
    private static RouteViewerLabelService NewSvc(NpScope scope)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        return new RouteViewerLabelService(
            factory,
            Substitute.For<IAlertLabelService>(),
            resolver,
            Substitute.For<INpScopeGuard>(),
            new HttpClient(),
            NullLogger<RouteViewerLabelService>.Instance);
    }

    [Fact]
    public async Task GetLineHaulLabelsAsync_NpWithAgentId_Throws()
    {
        var sut = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAsync<NpLabelScopeException>(() =>
            sut.GetLineHaulLabelsAsync(new LabelRequest()));
    }

    [Fact]
    public async Task GetLineHaulLabelsAsync_NpDegenerate_Throws()
    {
        var sut = NewSvc(new NpScope(false, null));
        await Assert.ThrowsAsync<NpLabelScopeException>(() =>
            sut.GetLineHaulLabelsAsync(new LabelRequest()));
    }

    [Fact]
    public async Task GetLineHaulManifestCsvAsync_NpWithAgentId_Throws()
    {
        var sut = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAsync<NpLabelScopeException>(() =>
            sut.GetLineHaulManifestCsvAsync(new LabelRequest()));
    }

    [Fact]
    public async Task GetLineHaulManifestCsvAsync_NpDegenerate_Throws()
    {
        var sut = NewSvc(new NpScope(false, null));
        await Assert.ThrowsAsync<NpLabelScopeException>(() =>
            sut.GetLineHaulManifestCsvAsync(new LabelRequest()));
    }

    // Regression guards for the two flows that already had the check, so a
    // future refactor cannot quietly drop them the way Mode 6 was dropped.

    [Fact]
    public async Task GetBulkLabelsAsync_NpWithAgentId_Throws()
    {
        var sut = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAsync<NpLabelScopeException>(() =>
            sut.GetBulkLabelsAsync(new LabelRequest()));
    }

    [Fact]
    public async Task GetBulkLabelsBySpeedAsync_NpWithAgentId_Throws()
    {
        var sut = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAsync<NpLabelScopeException>(() =>
            sut.GetBulkLabelsBySpeedAsync(new LabelRequest()));
    }

    // Admin must not be stopped by any of the above. Admin falls through
    // the guard into template lookup / proxy work, which has no SQL Server
    // or legacy backend here, so "not NpLabelScopeException" is the
    // assertion that matters.
    [Fact]
    public async Task GetLineHaulLabelsAsync_Admin_PassesTheGuard()
    {
        var sut = NewSvc(new NpScope(true, null));
        var ex = await Record.ExceptionAsync(() => sut.GetLineHaulLabelsAsync(new LabelRequest()));
        Assert.IsNotType<NpLabelScopeException>(ex);
    }

    [Fact]
    public async Task GetLineHaulManifestCsvAsync_Admin_PassesTheGuard()
    {
        var sut = NewSvc(new NpScope(true, null));
        var ex = await Record.ExceptionAsync(() => sut.GetLineHaulManifestCsvAsync(new LabelRequest()));
        Assert.IsNotType<NpLabelScopeException>(ex);
    }
}
