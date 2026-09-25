// Covers RunViewerReportController: 6 endpoints under /api/runviewer/reports.
// RouteViewerReportService admin-gates every method (NP degenerate scope
// returns Array.Empty<byte>()) then runs raw ADO / EF SQL that throws
// under InMemory. Focus:
//   * NP-degenerate scope short-circuit -> empty-body FileContentResult
//     on all 6 endpoints (controller wraps the empty array via File(...))
// Happy paths that hit real SPs / raw SQL are covered by service tests + E2E.
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerReportControllerTests
{
    private static RunViewerReportController NewCtl(bool isAdmin = false, int? npAgentId = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var factory = ControllerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(isAdmin, npAgentId));
        var svc = new RouteViewerReportService(factory, resolver,
            NullLogger<RouteViewerReportService>.Instance);
        var controller = new RunViewerReportController(svc);
        ControllerTestHarness.AttachHttpContext(controller);
        return controller;
    }

    // ── GetRunAllocation ────────────────────────────────────────────────

    [Fact]
    public async Task GetRunAllocation_NpDegenerate_ReturnsEmptyCsv()
    {
        var ctl = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetRunAllocation(new ReportRequest { RunDate = DateTime.Today });

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("text/csv", file.ContentType);
        Assert.Empty(file.FileContents);
    }

    // ── GetMissingScan ──────────────────────────────────────────────────

    [Fact]
    public async Task GetMissingScan_NpDegenerate_ReturnsEmptyCsv()
    {
        var ctl = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetMissingScan(new ReportRequest { RunDate = DateTime.Today });

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("text/csv", file.ContentType);
        Assert.Empty(file.FileContents);
    }

    // ── GetMissingRunScan ───────────────────────────────────────────────

    [Fact]
    public async Task GetMissingRunScan_NpDegenerate_ReturnsEmptyCsv()
    {
        var ctl = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetMissingRunScan(new ReportRequest { RunDate = DateTime.Today });

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("text/csv", file.ContentType);
        Assert.Empty(file.FileContents);
    }

    // ── GetMissingTransitScan ───────────────────────────────────────────

    [Fact]
    public async Task GetMissingTransitScan_NpDegenerate_ReturnsEmptyCsv()
    {
        var ctl = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetMissingTransitScan(new ReportRequest { RunDate = DateTime.Today });

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("text/csv", file.ContentType);
        Assert.Empty(file.FileContents);
    }

    // ── GetWoopRunNumber ────────────────────────────────────────────────

    [Fact]
    public async Task GetWoopRunNumber_NpSession_ReturnsEmptyXlsx()
    {
        // Woop admin-gate uses `if (!scope.IsAdmin) return empty` so any
        // non-admin (including NP with agent id) short-circuits.
        var ctl = NewCtl(isAdmin: false, npAgentId: 42);

        var result = await ctl.GetWoopRunNumber(new ReportRequest
        {
            FromDate = DateTime.Today,
            ToDate = DateTime.Today,
        });

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file.ContentType);
        Assert.Empty(file.FileContents);
    }

    // ── GetLinehaulReport ───────────────────────────────────────────────

    [Fact]
    public async Task GetLinehaulReport_NpDegenerate_ReturnsEmptyCsv()
    {
        // Linehaul service uses the same NP degenerate short-circuit as the
        // other CSV reports.
        var ctl = NewCtl(isAdmin: false, npAgentId: null);

        var result = await ctl.GetLinehaulReport(new ReportRequest());

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("text/csv", file.ContentType);
        Assert.Empty(file.FileContents);
    }
}
