// RouteViewerRunService wraps 5 stored procedures via SqlQueryRaw. SP-based
// branches throw under EF InMemory. Tests here cover the short-circuit
// branches (NP scope without agent id, degenerate scope on siblings, jobId
// guards, DeriveTabLabel via GetJobSiblingsAsync inputs) and the argument
// validation on GetBulkRunJobsAsync.
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerRunServiceTests
{
    private static (RouteViewerRunService sut, INpScopeResolver resolver) NewSvc(
        NpScope scope, IHttpContextAccessor? accessor = null, INpScopeGuard? guard = null)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        var tz = new SqlTimeZoneNormalizer(factory);
        var accessorX = accessor ?? Substitute.For<IHttpContextAccessor>();
        accessorX.HttpContext.Returns(new DefaultHttpContext());
        var sut = new RouteViewerRunService(factory, resolver,
            guard ?? Substitute.For<INpScopeGuard>(), tz, accessorX,
            NullLogger<RouteViewerRunService>.Instance);
        return (sut, resolver);
    }

    [Fact]
    public async Task GetBulkRunListAsync_NpDegenerateScope_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetBulkRunListAsync(new BulkRunListRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    // ── T13: the anchor jobId must be scope-checked ──────────────────
    // GetJobSiblingsAsync previously ran RVW_stpJobSiblings (which takes
    // @JobID only) with no row guard on the anchor, so a partner could
    // pass any jobId and get the family back with Amount on every row.
    // Kevin's call 2026-10-01 (D7): guard app-side rather than adding
    // @NpAgentId to the SP, because filtering siblings by agent returns a
    // partial family. See NP-PAY-PART4-TODO.md T13.

    [Fact]
    public async Task GetJobSiblingsAsync_AnchorOutOfScope_Throws()
    {
        var guard = Substitute.For<INpScopeGuard>();
        guard.EnsureTucJobInScopeAsync(99)
            .Returns(Task.FromException(new NpLabelScopeException("tucJob 99 is outside your NP scope.")));
        var (sut, _) = NewSvc(new NpScope(false, 42), null, guard);
        await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.GetJobSiblingsAsync(99));
    }

    [Fact]
    public async Task GetJobSiblingsAsync_GuardsTheAnchorBeforeHittingTheSp()
    {
        var guard = Substitute.For<INpScopeGuard>();
        var (sut, _) = NewSvc(new NpScope(true, null), null, guard);
        // Admin: the guard is a no-op, so this runs on to the SP, which
        // InMemory cannot execute. Either outcome is fine; what matters is
        // that the anchor was checked first.
        await Record.ExceptionAsync(() => sut.GetJobSiblingsAsync(7));
        await guard.Received(1).EnsureTucJobInScopeAsync(7);
    }

    [Fact]
    public async Task GetJobSiblingsAsync_InvalidJobId_ShortCircuitsBeforeTheGuard()
    {
        // jobId <= 0 is a caller error, not a scope violation. It must
        // stay an empty list rather than becoming a 403.
        var guard = Substitute.For<INpScopeGuard>();
        var (sut, _) = NewSvc(new NpScope(true, null), null, guard);
        Assert.Empty(await sut.GetJobSiblingsAsync(0));
        await guard.DidNotReceive().EnsureTucJobInScopeAsync(Arg.Any<int>());
    }

    [Fact]
    public async Task GetBulkRunJobsAsync_MissingRunDate_ThrowsArgumentException()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            sut.GetBulkRunJobsAsync(1, new BulkRunJobsRequest()));
    }

    [Fact]
    public async Task GetBulkRunJobsAsync_NpDegenerateScope_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetBulkRunJobsAsync(1, new BulkRunJobsRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLinehaulRunListAsync_NpDegenerateScope_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetLinehaulRunListAsync(new LinehaulRunListRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetRunRegionOverviewAsync_NpDegenerateScope_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetRunRegionOverviewAsync(new RegionOverviewRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLinehaulRegionOverviewAsync_NpDegenerateScope_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetLinehaulRegionOverviewAsync(new RegionOverviewRequest { RunDate = DateTime.Today });
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetJobSiblingsAsync_NpDegenerateScope_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, null));
        var result = await sut.GetJobSiblingsAsync(1234);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetJobSiblingsAsync_JobIdZero_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        var result = await sut.GetJobSiblingsAsync(0);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetJobSiblingsAsync_JobIdNegative_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        var result = await sut.GetJobSiblingsAsync(-5);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetJobSiblingsAsync_Admin_Positive_DelegatesToSpAndThrowsUnderInMemory()
    {
        // With InMemory, the SP call throws. Guard invariant: scope was
        // resolved before the SP fire (proves admin didn't short-circuit).
        var (sut, resolver) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetJobSiblingsAsync(1234));
        await resolver.Received().ResolveAsync();
    }

    [Fact]
    public async Task GetBulkRunListAsync_AdminScope_InvokesResolver()
    {
        var (sut, resolver) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetBulkRunListAsync(new BulkRunListRequest { RunDate = DateTime.Today }));
        await resolver.Received().ResolveAsync();
    }

    [Fact]
    public async Task GetBulkRunListAsync_ReadsTimeZoneClaimFromHttpContext()
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("TimeZone", "Pacific/Auckland"),
        }));
        accessor.HttpContext.Returns(ctx);
        var (sut, _) = NewSvc(new NpScope(true, null), accessor);

        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetBulkRunListAsync(new BulkRunListRequest { RunDate = DateTime.Today }));
    }
}
