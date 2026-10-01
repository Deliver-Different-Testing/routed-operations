// RouteViewerReportService produces CSV / XLSX from SP or raw-SQL result sets.
// Every method is admin-gated (short-circuits to empty byte array for
// NP scope). SP + raw SQL branches require a real SQL Server connection;
// under InMemory the ADO branch throws so we cover the admin short-circuit
// + verify the report methods surface the throw for admin.
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerReportServiceTests
{
    private static RouteViewerReportService NewSvc(NpScope scope)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        return new RouteViewerReportService(factory, resolver,
            NullLogger<RouteViewerReportService>.Instance);
    }

    [Fact]
    public async Task GetRunAllocationCsvAsync_NpDegenerate_ReturnsEmpty()
    {
        var sut = NewSvc(new NpScope(false, null));
        var result = await sut.GetRunAllocationCsvAsync(new ReportRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetMissingScanCsvAsync_NpDegenerate_ReturnsEmpty()
    {
        var sut = NewSvc(new NpScope(false, null));
        var result = await sut.GetMissingScanCsvAsync(new ReportRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetMissingRunScanCsvAsync_NpDegenerate_ReturnsEmpty()
    {
        var sut = NewSvc(new NpScope(false, null));
        var result = await sut.GetMissingRunScanCsvAsync(new ReportRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetMissingTransitScanCsvAsync_NpDegenerate_ReturnsEmpty()
    {
        var sut = NewSvc(new NpScope(false, null));
        var result = await sut.GetMissingTransitScanCsvAsync(new ReportRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    // ── A REAL network partner, i.e. one with a resolved NpAgentId. ──
    // Now that dbmigrationsv2 20261001153500 has given all four SPs an
    // @NpAgentId parameter, a scoped partner is ALLOWED through and the SP
    // filters their rows. So the assertion is "reaches the SP", not
    // "returns empty" - InMemory cannot execute the ADO path, same as the
    // _Admin_HitsSp cases below.
    //
    // These four exist because the gate once read
    // `!scope.IsAdmin && scope.NpAgentId == null` while the SPs had no way
    // to scope, which handed a partner the full tenant-wide CSV. They are
    // the regression cover for that whole sequence; the degenerate-partner
    // tests above stay as they are.
    // See NP-PAY-PART4-TODO.md T5/T6/T17/T18.

    [Fact]
    public async Task GetRunAllocationCsvAsync_NpWithAgentId_ReachesTheScopedSp()
    {
        var sut = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetRunAllocationCsvAsync(new ReportRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public async Task GetMissingScanCsvAsync_NpWithAgentId_ReachesTheScopedSp()
    {
        var sut = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetMissingScanCsvAsync(new ReportRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public async Task GetMissingRunScanCsvAsync_NpWithAgentId_ReachesTheScopedSp()
    {
        var sut = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetMissingRunScanCsvAsync(new ReportRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public async Task GetMissingTransitScanCsvAsync_NpWithAgentId_ReachesTheScopedSp()
    {
        var sut = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetMissingTransitScanCsvAsync(new ReportRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public async Task GetWoopRunNumberXlsxAsync_Np_ReturnsEmpty()
    {
        var sut = NewSvc(new NpScope(false, 42));
        var result = await sut.GetWoopRunNumberXlsxAsync(new ReportRequest());
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLinehaulCsvAsync_Np_ReturnsEmpty()
    {
        var sut = NewSvc(new NpScope(false, 42));
        var result = await sut.GetLinehaulCsvAsync(new ReportRequest());
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetRunAllocationCsvAsync_Admin_HitsSp()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetRunAllocationCsvAsync(new ReportRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public async Task GetMissingScanCsvAsync_Admin_HitsSp()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetMissingScanCsvAsync(new ReportRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public async Task GetMissingRunScanCsvAsync_Admin_HitsSp()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetMissingRunScanCsvAsync(new ReportRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public async Task GetMissingTransitScanCsvAsync_Admin_HitsSp()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetMissingTransitScanCsvAsync(new ReportRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public async Task GetWoopRunNumberXlsxAsync_Admin_HitsRawSql()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetWoopRunNumberXlsxAsync(new ReportRequest
            {
                FromDate = DateTime.Today,
                ToDate = DateTime.Today,
                GroupId = 100,
            }));
    }

    [Fact]
    public async Task GetLinehaulCsvAsync_Admin_HitsRawSql()
    {
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetLinehaulCsvAsync(new ReportRequest { LinehaulSpeedIds = "1,2,3" }));
    }

    [Fact]
    public async Task GetLinehaulCsvAsync_MalformedSpeedIds_DoesNotCrashOnWhitelist()
    {
        // Whitelist strips non-digit/comma chars; empty result falls back
        // to legacy NZ default. Still hits SQL Server so still throws.
        var sut = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetLinehaulCsvAsync(new ReportRequest { LinehaulSpeedIds = "abc-def" }));
    }
}
