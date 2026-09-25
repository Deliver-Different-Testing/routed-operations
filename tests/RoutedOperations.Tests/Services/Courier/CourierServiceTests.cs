using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using RoutedOperations.Core.Application.Services.Courier;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Courier;

public class CourierServiceTests
{
    private static CourierService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var factory = CockpitTestHarness.Factory(opts);
        var httpAccessor = Substitute.For<IHttpContextAccessor>();
        httpAccessor.HttpContext.Returns(new DefaultHttpContext());
        var cache = new TenantScopedCache(new MemoryCache(new MemoryCacheOptions()), httpAccessor);
        return new CourierService(factory, cache);
    }

    [Fact]
    public async Task GetActiveAsync_OnlyActiveCouriers()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.AddRange(
            new TucCourier { UccrId = 1, Code = "1", UccrName = "Active", Active = true },
            new TucCourier { UccrId = 2, Code = "2", UccrName = "Inactive", Active = false });
        await seed.SaveChangesAsync();

        var rows = await svc.GetActiveAsync();

        Assert.Single(rows);
        Assert.Equal(1, rows[0].CourierId);
    }

    [Fact]
    public async Task GetActiveAsync_OrdersByNumericCodeThenLexical()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.AddRange(
            new TucCourier { UccrId = 1, Code = "10", UccrName = "Ten", Active = true },
            new TucCourier { UccrId = 2, Code = "2", UccrName = "Two", Active = true },
            new TucCourier { UccrId = 3, Code = "A1", UccrName = "Alpha", Active = true });
        await seed.SaveChangesAsync();

        var rows = await svc.GetActiveAsync();

        Assert.Equal(new[] { "2", "10", "A1" }, rows.Select(r => r.Code).ToArray());
    }

    [Fact]
    public async Task GetActiveAsync_ProjectionAssemblesDisplayName()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 5, Code = "50", UccrName = "Fred", Active = true });
        await seed.SaveChangesAsync();

        var rows = await svc.GetActiveAsync();

        Assert.Equal("50 Fred", rows[0].DisplayName);
        Assert.Equal("50", rows[0].Code);
        Assert.Equal("Fred", rows[0].FirstName);
        Assert.Null(rows[0].Fleet);
    }

    [Fact]
    public async Task GetActiveAsync_JoinsFleetName()
    {
        var svc = NewSvc(out var seed);
        seed.TucCourierFleets.Add(new TucCourierFleet { UccfId = 7, UccfName = "Blue Fleet" });
        seed.TucCouriers.Add(new TucCourier
        {
            UccrId = 5, Code = "5", UccrName = "X", CourierFleetId = 7, Active = true
        });
        await seed.SaveChangesAsync();

        var rows = await svc.GetActiveAsync();

        Assert.Equal("Blue Fleet", rows[0].Fleet);
    }

    [Fact]
    public async Task GetActiveAsync_NullCodeBecomesEmpty()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, Code = null, UccrName = null, Active = true });
        await seed.SaveChangesAsync();

        var rows = await svc.GetActiveAsync();

        Assert.Equal(string.Empty, rows[0].Code);
        Assert.Equal(string.Empty, rows[0].FirstName);
        Assert.Equal(string.Empty, rows[0].DisplayName);
    }

    [Fact]
    public async Task GetActiveByFleetAsync_GroupsByFleetAndUnassignedBucket()
    {
        var svc = NewSvc(out var seed);
        seed.TucCourierFleets.Add(new TucCourierFleet { UccfId = 1, UccfName = "North" });
        seed.TucCouriers.AddRange(
            new TucCourier { UccrId = 1, Code = "1", UccrName = "A", CourierFleetId = 1, Active = true },
            new TucCourier { UccrId = 2, Code = "2", UccrName = "B", CourierFleetId = 1, Active = true },
            new TucCourier { UccrId = 3, Code = "3", UccrName = "C", CourierFleetId = null, Active = true });
        await seed.SaveChangesAsync();

        var groups = await svc.GetActiveByFleetAsync();

        Assert.Equal(2, groups.Count);
        var north = groups.Single(g => g.Fleet == "North");
        Assert.Equal(2, north.Couriers.Count);
        var unassigned = groups.Single(g => g.Fleet == "(Unassigned)");
        Assert.Single(unassigned.Couriers);
    }

    [Fact]
    public async Task GetActiveByFleetAsync_OrdersFleetsByName()
    {
        var svc = NewSvc(out var seed);
        seed.TucCourierFleets.AddRange(
            new TucCourierFleet { UccfId = 1, UccfName = "Zulu" },
            new TucCourierFleet { UccfId = 2, UccfName = "Alpha" });
        seed.TucCouriers.AddRange(
            new TucCourier { UccrId = 1, Code = "1", UccrName = "X", CourierFleetId = 1, Active = true },
            new TucCourier { UccrId = 2, Code = "2", UccrName = "Y", CourierFleetId = 2, Active = true });
        await seed.SaveChangesAsync();

        var groups = await svc.GetActiveByFleetAsync();

        Assert.Equal("Alpha", groups[0].Fleet);
        Assert.Equal("Zulu", groups[1].Fleet);
    }
}
