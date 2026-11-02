using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Pricing;
using RoutedOperations.Core.Application.Services.Pricing;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Pricing;

/// <summary>
/// The Pricing tab (spec 3.3, milestone M8).
///
/// Two inheritance rules sit on one screen and they are OPPOSITES, which is
/// the thing most likely to be got wrong and the thing that cannot be seen
/// once it is:
///
///   * Zone rates inherit per cell. A client cell falls back to the default
///     when the client has no row of its own.
///   * Dimension bands do not. A client with ANY bands of its own uses only
///     those, with no merge against the default.
///
/// The third thing pinned here is how a rate is found at all. Phase 1A added
/// BulkZoneRate.PostcodeGroupId but the backfill left it NULL on all 5,323
/// rows on Urgent, so rows are still reached through the group's depot. A
/// group-keyed read alone returns an empty grid on every group today.
/// </summary>
public class PricingServiceTests
{
    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    private static PricingService Svc(DbContextOptions<DespatchContext> opts)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(opts));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(opts)));
        return new PricingService(factory);
    }

    /// <summary>Group 62 on depot 8, zones 1 and 2, speeds 112 and 120,
    /// client 9196. Rate rows carry DepotId only, as production does.</summary>
    private static DbContextOptions<DespatchContext> Seed()
    {
        var opts = NewOptions();
        using var db = new DynamicDespatchDbContext(opts);
        db.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 8, Name = "Auckland", Active = true });
        db.BulkZonePostcodeGroups.Add(
            new BulkZonePostcodeGroup { Id = 62, Name = "Auckland AH Zones", DepotId = 8 });
        db.BulkZonePostcodes.AddRange(
            new BulkZonePostcode { Id = 1, PostcodeGroupId = 62, Zone = 1, PostCode = 1010, Name = "CBD", DepotId = 8 },
            new BulkZonePostcode { Id = 2, PostcodeGroupId = 62, Zone = 2, PostCode = 2112, Name = "Takanini", DepotId = 8 });
        db.TucJobTypes.AddRange(
            new TucJobType { UcjtId = 112, UcjtName = "Overnight" },
            new TucJobType { UcjtId = 120, UcjtName = "Same day" });
        db.TucClients.Add(new TucClient { UcclId = 9196, UcclCode = "CRECA", UcclName = "Credit Card" });
        db.BulkZoneRates.AddRange(
            new BulkZoneRate { Id = 1, DepotId = 8, Zone = 1, SpeedId = 112, Amount = 12.50m, CourierPercentage = 60m, Active = true },
            new BulkZoneRate { Id = 2, DepotId = 8, Zone = 2, SpeedId = 112, Amount = 14.00m, CourierPercentage = 60m, Active = true },
            new BulkZoneRate { Id = 3, DepotId = 8, Zone = 1, SpeedId = 120, Amount = 25.00m, CourierPercentage = 55m, Active = true });
        db.SaveChanges();
        return opts;
    }

    // ─── RESOLUTION ────────────────────────────────────────────────────────

    [Fact]
    public async Task Rates_are_found_through_the_groups_depot_while_the_group_column_is_empty()
    {
        // Every seeded row has DepotId and no PostcodeGroupId, as production
        // does. Matching on the group alone would show an empty grid.
        var opts = Seed();
        var grid = await Svc(opts).GetZoneRatesAsync(62);

        Assert.Equal("Auckland AH Zones", grid.PostcodeGroupName);
        Assert.Equal("Auckland", grid.DepotName);
        Assert.Equal(3, grid.Cells.Count);
        Assert.True(grid.ResolvedByDepot);
    }

    [Fact]
    public async Task A_zone_with_no_price_still_gets_a_row_to_type_into()
    {
        // Zones come from the group's postcodes, not from the rates, or a
        // zone nobody has priced is invisible and cannot be priced.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.BulkZonePostcodes.Add(new BulkZonePostcode
            { Id = 3, PostcodeGroupId = 62, Zone = 7, PostCode = 2576, Name = "Waiuku", DepotId = 8 });
            await pre.SaveChangesAsync();
        }

        var grid = await Svc(opts).GetZoneRatesAsync(62);
        Assert.Contains(7, grid.Zones);
        Assert.DoesNotContain(grid.Cells, c => c.Zone == 7);
    }

    // ─── ZONE RATE INHERITANCE ─────────────────────────────────────────────

    [Fact]
    public async Task A_client_cell_with_no_row_of_its_own_shows_the_default_as_inherited()
    {
        var opts = Seed();
        var grid = await Svc(opts).GetZoneRatesAsync(62, clientId: 9196);

        var cell = grid.Cells.Single(c => c.Zone == 1 && c.SpeedId == 112);
        Assert.Equal(12.50m, cell.Amount);
        Assert.True(cell.Inherited);
        Assert.Equal(0, grid.OverriddenCellCount);
    }

    [Fact]
    public async Task A_client_row_overrides_that_cell_and_is_counted()
    {
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.BulkZoneRates.Add(new BulkZoneRate
            { Id = 9, DepotId = 8, Zone = 1, SpeedId = 112, ClientId = 9196, Amount = 9.95m, Active = true });
            await pre.SaveChangesAsync();
        }

        var grid = await Svc(opts).GetZoneRatesAsync(62, clientId: 9196);
        var cell = grid.Cells.Single(c => c.Zone == 1 && c.SpeedId == 112);
        Assert.Equal(9.95m, cell.Amount);
        Assert.False(cell.Inherited);
        Assert.Equal(12.50m, cell.DefaultAmount);
        Assert.Equal(1, grid.OverriddenCellCount);

        // The default sheet is untouched by the client's row.
        var asDefault = await Svc(opts).GetZoneRatesAsync(62);
        Assert.Equal(12.50m, asDefault.Cells.Single(c => c.Zone == 1 && c.SpeedId == 112).Amount);
    }

    [Fact]
    public async Task Another_clients_price_never_leaks_into_this_one()
    {
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.TucClients.Add(new TucClient { UcclId = 9673, UcclCode = "ASURE", UcclName = "Asure" });
            pre.BulkZoneRates.Add(new BulkZoneRate
            { Id = 9, DepotId = 8, Zone = 1, SpeedId = 112, ClientId = 9673, Amount = 99.00m, Active = true });
            await pre.SaveChangesAsync();
        }

        var grid = await Svc(opts).GetZoneRatesAsync(62, clientId: 9196);
        var cell = grid.Cells.Single(c => c.Zone == 1 && c.SpeedId == 112);
        Assert.Equal(12.50m, cell.Amount);
        Assert.True(cell.Inherited);
    }

    [Fact]
    public async Task Writing_a_price_stamps_the_group_so_the_depot_fallback_stops_mattering()
    {
        // This is what fills PostcodeGroupId without a second backfill.
        var opts = Seed();
        await Svc(opts).UpsertZoneRateAsync(new ZoneRateUpsertRequest
        { PostcodeGroupId = 62, Zone = 1, SpeedId = 112, Amount = 13.00m });

        await using var db = new DynamicDespatchDbContext(opts);
        var row = await db.BulkZoneRates.SingleAsync(r => r.Id == 1);
        Assert.Equal(13.00m, row.Amount);
        Assert.Equal(62, row.PostcodeGroupId);
        Assert.Equal(8, row.DepotId);
    }

    [Fact]
    public async Task Clearing_a_client_override_retires_its_row_so_the_default_shows_again()
    {
        // Writing a zero would be a real price of nothing, which is a
        // different statement from "this client pays the standard rate".
        var opts = Seed();
        var svc = Svc(opts);
        await svc.UpsertZoneRateAsync(new ZoneRateUpsertRequest
        { PostcodeGroupId = 62, Zone = 1, SpeedId = 112, ClientId = 9196, Amount = 9.95m });

        var cleared = await svc.UpsertZoneRateAsync(new ZoneRateUpsertRequest
        { PostcodeGroupId = 62, Zone = 1, SpeedId = 112, ClientId = 9196, Amount = null });

        Assert.True(cleared.Inherited);
        Assert.Equal(12.50m, cleared.Amount);

        var grid = await svc.GetZoneRatesAsync(62, clientId: 9196);
        Assert.Equal(0, grid.OverriddenCellCount);
    }

    [Fact]
    public async Task Reset_to_default_drops_every_override_in_the_group_and_only_that_client()
    {
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.TucClients.Add(new TucClient { UcclId = 9673, UcclCode = "ASURE", UcclName = "Asure" });
            pre.BulkZoneRates.AddRange(
                new BulkZoneRate { Id = 9, DepotId = 8, Zone = 1, SpeedId = 112, ClientId = 9196, Amount = 9.95m, Active = true },
                new BulkZoneRate { Id = 10, DepotId = 8, Zone = 2, SpeedId = 112, ClientId = 9196, Amount = 11.00m, Active = true },
                new BulkZoneRate { Id = 11, DepotId = 8, Zone = 1, SpeedId = 112, ClientId = 9673, Amount = 8.00m, Active = true });
            await pre.SaveChangesAsync();
        }

        var dropped = await Svc(opts).ResetClientOverridesAsync(62, 9196);
        Assert.Equal(2, dropped);

        var other = await Svc(opts).GetZoneRatesAsync(62, clientId: 9673);
        Assert.Equal(1, other.OverriddenCellCount);
    }

    [Fact]
    public async Task A_negative_rate_or_an_out_of_range_courier_percentage_is_refused()
    {
        var opts = Seed();
        var svc = Svc(opts);

        var neg = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.UpsertZoneRateAsync(new ZoneRateUpsertRequest
            { PostcodeGroupId = 62, Zone = 1, SpeedId = 112, Amount = -1m }));
        Assert.Contains("negative", neg.Message);

        var pct = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.UpsertZoneRateAsync(new ZoneRateUpsertRequest
            { PostcodeGroupId = 62, Zone = 1, SpeedId = 112, Amount = 1m, CourierPercentage = 140m }));
        Assert.Contains("between 0 and 100", pct.Message);
    }

    // ─── DIMENSION BANDS: THE OPPOSITE RULE ────────────────────────────────

    [Fact]
    public async Task A_client_with_no_bands_of_its_own_sees_the_default_bands()
    {
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.BulkZonePackageRates.Add(new BulkZonePackageRate
            { Id = 1, ClientId = null, Name = "Standard", FromWeight = 0, ToWeight = 25, CubicRate = 1.5m });
            await pre.SaveChangesAsync();
        }

        var data = await Svc(opts).GetPackageRatesAsync(9196);
        Assert.False(data.UsingOwnRows);
        Assert.Equal("Standard", Assert.Single(data.Rows).Name);
    }

    [Fact]
    public async Task A_client_with_any_bands_of_its_own_uses_only_those_and_never_merges()
    {
        // The default band is NOT added to the client's. Merging them would
        // silently price a weight the client deliberately left uncovered.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.BulkZonePackageRates.AddRange(
                new BulkZonePackageRate { Id = 1, ClientId = null, Name = "Standard", FromWeight = 0, ToWeight = 25, CubicRate = 1.5m },
                new BulkZonePackageRate { Id = 2, ClientId = null, Name = "Heavy", FromWeight = 25, ToWeight = 100, CubicRate = 2.5m },
                new BulkZonePackageRate { Id = 3, ClientId = 9196, Name = "Theirs", FromWeight = 0, ToWeight = 10, CubicRate = 1.0m });
            await pre.SaveChangesAsync();
        }

        var data = await Svc(opts).GetPackageRatesAsync(9196);
        Assert.True(data.UsingOwnRows);
        Assert.Equal("Theirs", Assert.Single(data.Rows).Name);
    }

    [Fact]
    public async Task A_band_that_starts_above_where_it_ends_is_refused()
    {
        var opts = Seed();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Svc(opts).UpsertPackageRateAsync(new PackageRateUpsertRequest
            { FromWeight = 50, ToWeight = 10, CubicRate = 1m }));
        Assert.Contains("starts above", ex.Message);
    }

    // ─── SURCHARGES ────────────────────────────────────────────────────────

    [Fact]
    public async Task A_surcharge_postcode_folds_onto_the_int_and_reads_back_padded()
    {
        // Same column shape as BulkZonePostcode: PostCode is an int, so 0110
        // is stored as 110 and has to read back as "0110".
        var opts = Seed();
        var saved = await Svc(opts).UpsertSurchargeAsync(new SurchargeUpsertRequest
        { Postcode = "110", Surcharge = 4.50m });

        Assert.Equal("0110", saved.Code);
        Assert.Equal(110, saved.Value);

        // The same code again edits that row rather than adding a second.
        await Svc(opts).UpsertSurchargeAsync(new SurchargeUpsertRequest
        { Postcode = "0110", Surcharge = 5.00m });

        var rows = await Svc(opts).GetSurchargesAsync();
        var only = Assert.Single(rows);
        Assert.Equal(5.00m, only.Surcharge);
    }

    [Fact]
    public async Task A_surcharge_on_something_that_is_not_a_postcode_is_refused()
    {
        var opts = Seed();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Svc(opts).UpsertSurchargeAsync(new SurchargeUpsertRequest
            { Postcode = "ABCD", Surcharge = 1m }));
        Assert.Contains("not a postcode", ex.Message);
    }

    [Fact]
    public async Task A_clients_surcharges_are_separate_from_the_default_list()
    {
        var opts = Seed();
        var svc = Svc(opts);
        await svc.UpsertSurchargeAsync(new SurchargeUpsertRequest { Postcode = "0110", Surcharge = 4.50m });
        await svc.UpsertSurchargeAsync(new SurchargeUpsertRequest
        { Postcode = "0110", ClientId = 9196, Surcharge = 2.00m });

        Assert.Equal(4.50m, Assert.Single(await svc.GetSurchargesAsync()).Surcharge);
        Assert.Equal(2.00m, Assert.Single(await svc.GetSurchargesAsync(9196)).Surcharge);
    }

    // ─── SPEEDS ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Offering_a_speed_for_a_client_is_separate_from_offering_it_globally()
    {
        var opts = Seed();
        var svc = Svc(opts);
        await svc.SetSpeedOfferedAsync(112, offered: true);

        var forClient = (await svc.GetOfferedSpeedsAsync(9196)).Single(s => s.SpeedId == 112);
        Assert.True(forClient.OfferedGlobally);
        // A client with no row of its own is not offered it: the client list
        // is exact, not additive.
        Assert.False(forClient.OfferedForClient);

        await svc.SetSpeedOfferedAsync(112, offered: true, clientId: 9196);
        var after = (await svc.GetOfferedSpeedsAsync(9196)).Single(s => s.SpeedId == 112);
        Assert.True(after.OfferedForClient);
    }

    [Fact]
    public async Task Un_offering_removes_the_row_rather_than_leaving_a_dead_one()
    {
        var opts = Seed();
        var svc = Svc(opts);
        await svc.SetSpeedOfferedAsync(112, offered: true, clientId: 9196);
        await svc.SetSpeedOfferedAsync(112, offered: false, clientId: 9196);

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(0, await db.BulkImportSpeeds.CountAsync());
    }

    [Fact]
    public async Task An_unknown_speed_or_client_is_refused_by_name()
    {
        var opts = Seed();
        var svc = Svc(opts);

        var speed = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.SetSpeedOfferedAsync(888, offered: true));
        Assert.Contains("888", speed.Message);

        var client = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.UpsertZoneRateAsync(new ZoneRateUpsertRequest
            { PostcodeGroupId = 62, Zone = 1, SpeedId = 112, ClientId = 777, Amount = 1m }));
        Assert.Contains("777", client.Message);
    }
}
