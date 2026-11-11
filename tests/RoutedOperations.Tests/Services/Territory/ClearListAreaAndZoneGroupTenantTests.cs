using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Territory;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// Driver location list picker feed + which tenants get zone groups.
///
///   * The clear-list areas feed the Zone Group "Driver Location List" select.
///     The order is the operator's own (tblClearListArea.Order), so a list that
///     comes back alphabetical or by id would silently reshuffle the picker
///     against what Configurator shows for the same lists.
///   * Zone groups point at a driver location list on US AND AU tenants. An AU
///     tenant that gets nothing back sees an empty Zone Groups screen and reads
///     it as "no groups configured". NZ has none, and the bootstrap must not
///     start sending them there.
/// </summary>
public class ClearListAreaAndZoneGroupTenantTests
{
    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    private static TerritoryService Svc(DbContextOptions<DespatchContext> opts, string countryCode)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(opts));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(opts)));

        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new List<Claim>
            {
                new("CountryCode", countryCode),
            })),
        });
        return new TerritoryService(factory, accessor);
    }

    private static DbContextOptions<DespatchContext> SeedAreas()
    {
        var opts = NewOptions();
        using var db = new DynamicDespatchDbContext(opts);
        db.TblClearListAreas.AddRange(
            new TblClearListArea { ClearListAreaId = 1, Code = "SYD", Name = "Sydney", Order = 2 },
            new TblClearListArea { ClearListAreaId = 2, Code = "MEL", Name = "Melbourne", Order = 1 },
            new TblClearListArea { ClearListAreaId = 3, Code = "BNE", Name = "Brisbane", Order = 2 });
        db.SaveChanges();
        return opts;
    }

    private static DbContextOptions<DespatchContext> SeedZoneGroups()
    {
        var opts = NewOptions();
        using var db = new DynamicDespatchDbContext(opts);
        db.ZoneGroups.Add(new ZoneGroup { ZoneGroupId = 50, Name = "Metro", ClearListAreaId = 2 });
        db.ZoneNames.Add(new ZoneName { ZoneNameId = 1, ZoneName1 = "Inner West", LocationId = 8, ZoneGroupId = 50 });
        db.SaveChanges();
        return opts;
    }

    [Fact]
    public async Task Clear_list_areas_come_back_in_operator_order_then_name()
    {
        var areas = await Svc(SeedAreas(), "AU").GetClearListAreasAsync();

        // Melbourne is Order 1. Brisbane and Sydney tie on Order 2 and break
        // by name, not by id (Sydney has the lower id).
        Assert.Equal(new[] { 2, 3, 1 }, areas.Select(a => a.Id).ToArray());
    }

    [Fact]
    public async Task Clear_list_area_carries_id_code_and_name()
    {
        var mel = (await Svc(SeedAreas(), "US").GetClearListAreasAsync()).First();

        Assert.Equal(2, mel.Id);
        Assert.Equal("MEL", mel.Code);
        Assert.Equal("Melbourne", mel.Name);
    }

    [Theory]
    [InlineData("US")]
    [InlineData("AU")]
    [InlineData("au")]
    public async Task Bootstrap_sends_zone_groups_and_zone_names_to_us_and_au(string country)
    {
        var boot = await Svc(SeedZoneGroups(), country).GetBootstrapAsync();

        var group = Assert.Single(boot.ZoneGroups);
        Assert.Equal(2, group.ClearListAreaId);
        Assert.Single(boot.ZoneNames);
    }

    [Theory]
    [InlineData("NZ")]
    [InlineData("")]
    public async Task Bootstrap_sends_no_zone_groups_to_nz(string country)
    {
        var boot = await Svc(SeedZoneGroups(), country).GetBootstrapAsync();

        Assert.Empty(boot.ZoneGroups);
        Assert.Empty(boot.ZoneNames);
    }

    [Fact]
    public async Task Au_bootstrap_still_takes_the_nz_postcode_path()
    {
        // Opening zone groups to AU must not move AU onto the US zip path:
        // AU postcodes are 4-digit and live in BulkZonePostcode like NZ.
        var boot = await Svc(SeedZoneGroups(), "AU").GetBootstrapAsync();

        Assert.Equal("NZ", boot.CountryCode);
        Assert.Empty(boot.UsZipZones);
    }
}
