// RouteViewerFilterService wraps 5 lookup SPs + a plain EF SuburbList read.
// The SP-invoking methods (Client/Speed/Region/TopUp lists) throw under
// InMemory. GetSuburbListAsync is EF-only so is fully covered.
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerFilterServiceTests
{
    private static (RouteViewerFilterService sut, DynamicDespatchDbContext seed) NewSvc()
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var seed = RouteViewerTestHarness.Context(opts);
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext());
        var sut = new RouteViewerFilterService(factory, resolver, accessor,
            NullLogger<RouteViewerFilterService>.Instance);
        return (sut, seed);
    }

    [Fact]
    public async Task GetSuburbListAsync_EmptyDb_ReturnsEmpty()
    {
        var (sut, _) = NewSvc();
        var result = await sut.GetSuburbListAsync();
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetSuburbListAsync_ReturnsSuburbsWithAliasMapping()
    {
        var (sut, seed) = NewSvc();
        seed.TucSuburbs.Add(new TucSuburb { UcsuId = 1, UcsuName = "Auckland", GoogleSuburbAlias = "Auckland CBD" });
        seed.TucSuburbs.Add(new TucSuburb { UcsuId = 2, UcsuName = "Wellington", GoogleSuburbAlias = null });
        await seed.SaveChangesAsync();

        var result = await sut.GetSuburbListAsync();

        Assert.Equal(2, result.Count);
        var akl = result.Single(r => r.id == 1);
        Assert.Equal("Auckland", akl.label);
        Assert.Equal("Auckland CBD", akl.alias);
        var wlg = result.Single(r => r.id == 2);
        Assert.Null(wlg.alias);
    }

    [Fact]
    public async Task GetClientListAsync_ThrowsUnderInMemory()
    {
        var (sut, _) = NewSvc();
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetClientListAsync(DateTime.Today, multipleClients: false, contactId: null));
    }

    [Fact]
    public async Task GetSpeedListAsync_ThrowsUnderInMemory()
    {
        var (sut, _) = NewSvc();
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetSpeedListAsync(DateTime.Today));
    }

    [Fact]
    public async Task GetRegionListAsync_ThrowsUnderInMemory()
    {
        var (sut, _) = NewSvc();
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetRegionListAsync(DateTime.Today));
    }

    [Fact]
    public async Task GetTopUpListAsync_ThrowsUnderInMemory()
    {
        var (sut, _) = NewSvc();
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetTopUpListAsync());
    }
}
