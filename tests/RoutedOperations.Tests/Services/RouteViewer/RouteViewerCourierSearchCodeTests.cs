// #816: the run menu's Re-assign / Pre-assign picker sends the picked
// courier's code to the run-level SPs. RVW_stpCourierActive only returns
// ID + Text, so the search must look the code up itself; before this it
// returned Code = null for every courier and the picker refused them all
// ("This courier has no code and cannot be pre-assigned").
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerCourierSearchCodeTests
{
    private sealed class FakeSpService(
        IDbContextFactory<DynamicDespatchDbContext> factory,
        INpScopeResolver resolver,
        List<(int Id, string? Text)> rows)
        : RouteViewerCourierService(factory, resolver, NullLogger<RouteViewerCourierService>.Instance)
    {
        protected override Task<List<RawCourierSearchRow>> RunCourierSearchSpAsync(string? searchTerm) =>
            Task.FromResult(rows.Select(r => new RawCourierSearchRow { ID = r.Id, Text = r.Text }).ToList());
    }

    private static RouteViewerCourierService NewSvc(List<(int, string?)> spRows, params TucCourier[] couriers)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        using (var seed = RouteViewerTestHarness.Context(opts))
        {
            seed.TucCouriers.AddRange(couriers);
            seed.SaveChanges();
        }
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        return new FakeSpService(RouteViewerTestHarness.Factory(opts), resolver, spRows);
    }

    [Fact]
    public async Task SearchActiveCouriersAsync_ReturnsEachCouriersCode()
    {
        var sut = NewSvc(
            [(193, "193 Overnight Service"), (40, "40 Tuck Jackson")],
            new TucCourier { UccrId = 193, Code = "193", UccrName = "Overnight", UccrSurname = "Service", Active = true },
            new TucCourier { UccrId = 40, Code = "40", UccrName = "Tuck", UccrSurname = "Jackson", Active = true });

        var result = await sut.SearchActiveCouriersAsync("1");

        Assert.Equal(new[] { 193, 40 }, result.Select(r => r.CourierId));
        Assert.Equal(new[] { "193", "40" }, result.Select(r => r.Code));
        Assert.Equal("193 Overnight Service", result[0].Name);
    }

    [Fact]
    public async Task SearchActiveCouriersAsync_CourierWithBlankCode_StaysNull()
    {
        var sut = NewSvc(
            [(7, "Legacy Courier")],
            new TucCourier { UccrId = 7, Code = "  ", UccrName = "Legacy", UccrSurname = "Courier", Active = true });

        var result = await sut.SearchActiveCouriersAsync("Leg");

        Assert.Single(result);
        Assert.Null(result[0].Code);
    }
}
