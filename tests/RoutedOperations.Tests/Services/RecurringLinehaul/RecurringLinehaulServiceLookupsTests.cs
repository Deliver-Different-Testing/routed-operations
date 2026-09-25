using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

/// <summary>
/// Covers GetLookupsAsync - the depot + courier picker feed for the Linehaul modal.
/// Active-only + alphabetically ordered on both sides. Depot code / hint fields
/// resolve from raw columns without extra plumbing.
/// </summary>
public class RecurringLinehaulServiceLookupsTests
{
    private static RecurringLinehaulService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = RecurringLinehaulTestHarness.NewOptions();
        seed = RecurringLinehaulTestHarness.Context(opts);
        return new RecurringLinehaulService(RecurringLinehaulTestHarness.Factory(opts));
    }

    [Fact]
    public async Task GetLookupsAsync_ReturnsOnlyActiveDepots()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 1, Name = "Auckland", Active = true },
            new TblBulkRegion { BulkRegionId = 2, Name = "Retired", Active = false });
        await seed.SaveChangesAsync();

        var lookups = await svc.GetLookupsAsync();

        Assert.Single(lookups.Depots);
        Assert.Equal("Auckland", lookups.Depots[0].Name);
    }

    [Fact]
    public async Task GetLookupsAsync_OrdersDepotsByName()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 1, Name = "Wellington", Active = true },
            new TblBulkRegion { BulkRegionId = 2, Name = "Auckland", Active = true },
            new TblBulkRegion { BulkRegionId = 3, Name = "Christchurch", Active = true });
        await seed.SaveChangesAsync();

        var lookups = await svc.GetLookupsAsync();

        Assert.Equal(new[] { "Auckland", "Christchurch", "Wellington" },
            lookups.Depots.Select(d => d.Name).ToArray());
    }

    [Fact]
    public async Task GetLookupsAsync_DepotMapsIdAndName()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 99, Name = "Depot99", Active = true });
        await seed.SaveChangesAsync();

        var lookup = (await svc.GetLookupsAsync()).Depots.Single();

        Assert.Equal(99, lookup.Id);
        Assert.Equal("Depot99", lookup.Name);
    }

    [Fact]
    public async Task GetLookupsAsync_DepotNullNameCoercesToEmpty()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = null, Active = true });
        await seed.SaveChangesAsync();

        var lookup = (await svc.GetLookupsAsync()).Depots.Single();

        Assert.Equal(string.Empty, lookup.Name);
    }

    [Fact]
    public async Task GetLookupsAsync_ReturnsOnlyActiveCouriers()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.AddRange(
            new TucCourier { UccrId = 1, UccrName = "Alice", UccrSurname = "One", Code = "A1", Active = true },
            new TucCourier { UccrId = 2, UccrName = "Bob", UccrSurname = "Two", Code = "B2", Active = false });
        await seed.SaveChangesAsync();

        var lookups = await svc.GetLookupsAsync();

        Assert.Single(lookups.Couriers);
        Assert.Equal(1, lookups.Couriers[0].Id);
    }

    [Fact]
    public async Task GetLookupsAsync_OrdersCouriersByNameThenSurname()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.AddRange(
            new TucCourier { UccrId = 1, UccrName = "Bob", UccrSurname = "Zed", Code = "B", Active = true },
            new TucCourier { UccrId = 2, UccrName = "Alice", UccrSurname = "Baker", Code = "A2", Active = true },
            new TucCourier { UccrId = 3, UccrName = "Alice", UccrSurname = "Adams", Code = "A1", Active = true });
        await seed.SaveChangesAsync();

        var lookups = await svc.GetLookupsAsync();

        Assert.Equal(new[] { 3, 2, 1 }, lookups.Couriers.Select(c => c.Id).ToArray());
    }

    [Fact]
    public async Task GetLookupsAsync_CourierNameJoinsFirstAndSurnameTrimmed()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "Alice", UccrSurname = "Smith", Code = "AS", Active = true });
        await seed.SaveChangesAsync();

        var courier = (await svc.GetLookupsAsync()).Couriers.Single();

        Assert.Equal("Alice Smith", courier.Name);
    }

    [Fact]
    public async Task GetLookupsAsync_CourierMissingSurnameStillTrimmedCleanly()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "Solo", UccrSurname = string.Empty, Code = "S", Active = true });
        await seed.SaveChangesAsync();

        var courier = (await svc.GetLookupsAsync()).Couriers.Single();

        Assert.Equal("Solo", courier.Name);
    }

    [Fact]
    public async Task GetLookupsAsync_CourierNullCodeCoercesToEmpty()
    {
        var svc = NewSvc(out var seed);
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "N", UccrSurname = "C", Code = null, Active = true });
        await seed.SaveChangesAsync();

        var courier = (await svc.GetLookupsAsync()).Couriers.Single();

        Assert.Equal(string.Empty, courier.Code);
    }

    [Fact]
    public async Task GetLookupsAsync_EmptyDatabaseReturnsEmptyLists()
    {
        var svc = NewSvc(out _);

        var lookups = await svc.GetLookupsAsync();

        Assert.Empty(lookups.Depots);
        Assert.Empty(lookups.Couriers);
    }
}
