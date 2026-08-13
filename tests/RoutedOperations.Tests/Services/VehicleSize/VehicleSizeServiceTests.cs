using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using RoutedOperations.Core.Application.Services.VehicleSize;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.VehicleSize;

public class VehicleSizeServiceTests
{
    private static VehicleSizeService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var factory = CockpitTestHarness.Factory(opts);
        var httpAccessor = Substitute.For<IHttpContextAccessor>();
        httpAccessor.HttpContext.Returns(new DefaultHttpContext());
        var cache = new TenantScopedCache(new MemoryCache(new MemoryCacheOptions()), httpAccessor);
        return new VehicleSizeService(factory, cache);
    }

    [Fact]
    public async Task GetAllAsync_ReturnsVehiclesWithCubicOnlyOrderedByCubicThenName()
    {
        var svc = NewSvc(out var seed);
        seed.VehicleSizes.AddRange(
            new Core.Domain.Despatch.VehicleSize { VehicleSizeId = 1, VehicleName = "Van A", CubicCapacity = 5.0m },
            new Core.Domain.Despatch.VehicleSize { VehicleSizeId = 2, VehicleName = "Truck", CubicCapacity = 25.0m },
            new Core.Domain.Despatch.VehicleSize { VehicleSizeId = 3, VehicleName = "Bike", CubicCapacity = null });
        await seed.SaveChangesAsync();

        var rows = await svc.GetAllAsync();

        Assert.Equal(2, rows.Count);
        Assert.Equal("Van A", rows[0].VehicleName);
        Assert.Equal(5.0m, rows[0].CubicCapacity);
        Assert.Equal("Truck", rows[1].VehicleName);
    }

    [Fact]
    public async Task GetAllAsync_TieBreaksOnVehicleName()
    {
        var svc = NewSvc(out var seed);
        seed.VehicleSizes.AddRange(
            new Core.Domain.Despatch.VehicleSize { VehicleSizeId = 1, VehicleName = "Zeta", CubicCapacity = 10 },
            new Core.Domain.Despatch.VehicleSize { VehicleSizeId = 2, VehicleName = "Alpha", CubicCapacity = 10 });
        await seed.SaveChangesAsync();

        var rows = await svc.GetAllAsync();

        Assert.Equal("Alpha", rows[0].VehicleName);
        Assert.Equal("Zeta", rows[1].VehicleName);
    }

    [Fact]
    public async Task GetAllAsync_NullNameBecomesEmptyString()
    {
        var svc = NewSvc(out var seed);
        seed.VehicleSizes.Add(new Core.Domain.Despatch.VehicleSize
        {
            VehicleSizeId = 1, VehicleName = null, CubicCapacity = 10
        });
        await seed.SaveChangesAsync();

        var rows = await svc.GetAllAsync();

        Assert.Single(rows);
        Assert.Equal(string.Empty, rows[0].VehicleName);
    }

    [Fact]
    public async Task GetAllAsync_EmptyDbReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await svc.GetAllAsync();

        Assert.Empty(rows);
    }
}
