using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Schedule;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Schedule;

/// <summary>
/// The zones the schedule leg editor offers for ticking.
///
/// What persists is a zone NUMBER, and a number only means something next to
/// a depot: the availability function resolves a tick by joining the zone's
/// depot to the schedule's region. Each of these encodes a decision that is
/// invisible from the screen, and every one of them fails silently rather
/// than crashing - the operator ticks something that can never match, and the
/// schedule quietly serves nothing.
///
///   * The source is tenant-dependent. NZ zone membership lives in
///     BulkZonePostcode and US membership in ZoneZip. Reading the NZ table on
///     a US tenant returns nothing, which reads as "this tenant has no zones"
///     and is exactly the shape of the bug this picker had.
///   * A zone with no depot is left out. 59 of the 76 zones on Medical
///     Couriers have none, and the availability function can never match
///     them, so offering them would be offering a tick that does nothing.
///   * Two zones at one depot may share a number, and the tick covers both.
///     Medical Couriers depot 35 has Sacramento and SMF on number 1. One
///     chip, both names, or the operator cannot tell what they just ticked.
/// </summary>
public class ZoneOptionTests
{
    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    private static ScheduleService Svc(DbContextOptions<DespatchContext> opts, bool isUs)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(opts));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(opts)));

        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        // Literal "US" is the only value that takes the US path; anything
        // else, including a missing claim, is NZ.
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new List<Claim>
        {
            new("CountryCode", isUs ? "US" : "NZ"),
            new("CurrentTenantID", "1"),
        }));
        accessor.HttpContext.Returns(ctx);

        return new ScheduleService(
            factory,
            NullLogger<ScheduleService>.Instance,
            new TenantScopedCache(new MemoryCache(new MemoryCacheOptions()), accessor),
            Substitute.For<IScheduleConverter>(),
            accessor);
    }

    /// <summary>Seeded with BOTH tenants' member rows, so a query that reads
    /// the wrong table still returns something and the test fails on the
    /// value rather than on emptiness.</summary>
    private static DbContextOptions<DespatchContext> SeedBothTenants()
    {
        var opts = NewOptions();
        using var db = new DynamicDespatchDbContext(opts);

        db.ZoneGroups.Add(new ZoneGroup { ZoneGroupId = 50, Name = "Bay Area" });

        db.ZoneNames.AddRange(
            // Two zones at depot 36 on different numbers.
            new ZoneName { ZoneNameId = 1, ZoneName1 = "Hayward", LocationId = 36, ZoneGroupId = 50 },
            new ZoneName { ZoneNameId = 2, ZoneName1 = "OAK", LocationId = 36, ZoneGroupId = 50 },
            // Two zones at depot 35 SHARING number 7.
            new ZoneName { ZoneNameId = 3, ZoneName1 = "Sacramento", LocationId = 35, ZoneGroupId = 50 },
            new ZoneName { ZoneNameId = 4, ZoneName1 = "SMF", LocationId = 35, ZoneGroupId = 50 },
            // No depot. Can never be matched by the availability function.
            new ZoneName { ZoneNameId = 5, ZoneName1 = "BERGN", LocationId = null, ZoneGroupId = 50 });

        db.ZoneZips.AddRange(
            new ZoneZip { ZoneZipId = 1, Zip = "94010", ZoneNumber = 1, ZoneNameId = 1 },
            new ZoneZip { ZoneZipId = 2, Zip = "94011", ZoneNumber = 1, ZoneNameId = 1 },
            new ZoneZip { ZoneZipId = 3, Zip = "93210", ZoneNumber = 2, ZoneNameId = 2 },
            new ZoneZip { ZoneZipId = 4, Zip = "95814", ZoneNumber = 7, ZoneNameId = 3 },
            new ZoneZip { ZoneZipId = 5, Zip = "95815", ZoneNumber = 7, ZoneNameId = 4 },
            // On the depot-less zone, so it must not appear at all.
            new ZoneZip { ZoneZipId = 6, Zip = "07030", ZoneNumber = 4, ZoneNameId = 5 },
            // No zone number. The number IS the key a tick resolves by, so a
            // row without one cannot be offered.
            new ZoneZip { ZoneZipId = 7, Zip = "94012", ZoneNumber = null, ZoneNameId = 1 });

        // NZ membership, deliberately different numbers so a wrong-table read
        // is visible in the values rather than as an empty list.
        db.BulkZonePostcodes.AddRange(
            new BulkZonePostcode { Id = 1, PostCode = 1010, Zone = 21, DepotId = 8, Name = "Auckland Central" },
            new BulkZonePostcode { Id = 2, PostCode = 1011, Zone = 21, DepotId = 8, Name = "Auckland Central" },
            new BulkZonePostcode { Id = 3, PostCode = 3010, Zone = 22, DepotId = 8, Name = "Hamilton" },
            // No depot, so it cannot be offered on NZ either.
            new BulkZonePostcode { Id = 4, PostCode = 9010, Zone = 23, DepotId = null, Name = "Orphan" });

        db.SaveChanges();
        return opts;
    }

    [Fact]
    public async Task Us_offers_zone_numbers_scoped_to_their_depot()
    {
        var zones = (await Svc(SeedBothTenants(), isUs: true).GetLookupsAsync()).Zones;

        Assert.Equal(
            new[] { (35, 7), (36, 1), (36, 2) },
            zones.Select(z => (z.DepotId, z.Zone)).OrderBy(t => t.DepotId).ThenBy(t => t.Zone).ToArray());
    }

    [Fact]
    public async Task Us_leaves_out_a_zone_with_no_depot()
    {
        var zones = (await Svc(SeedBothTenants(), isUs: true).GetLookupsAsync()).Zones;

        // BERGN holds 07030 on number 4, but it has no depot, so the
        // availability function could never match it on any leg.
        Assert.DoesNotContain(zones, z => z.Zone == 4);
        Assert.DoesNotContain(zones, z => z.Label.Contains("BERGN"));
    }

    [Fact]
    public async Task Us_leaves_out_a_zip_row_with_no_zone_number()
    {
        var zones = (await Svc(SeedBothTenants(), isUs: true).GetLookupsAsync()).Zones;

        // 94012 sits on Hayward with no number. It must not inflate Hayward's
        // count, because a tick cannot address it.
        var hayward = Assert.Single(zones, z => z.DepotId == 36 && z.Zone == 1);
        Assert.Equal(2, hayward.ZipCount);
    }

    [Fact]
    public async Task Us_shows_two_zones_sharing_a_number_as_one_option_naming_both()
    {
        var zones = (await Svc(SeedBothTenants(), isUs: true).GetLookupsAsync()).Zones;

        var shared = Assert.Single(zones, z => z.DepotId == 35);
        Assert.Equal(7, shared.Zone);
        // Both names, because the tick covers both zones.
        Assert.Equal("Sacramento + SMF", shared.Label);
        Assert.Equal(2, shared.ZipCount);
    }

    [Fact]
    public async Task Us_carries_the_zone_group_so_pricing_and_coverage_read_apart()
    {
        var zones = (await Svc(SeedBothTenants(), isUs: true).GetLookupsAsync()).Zones;

        Assert.All(zones, z => Assert.Equal("Bay Area", z.GroupLabel));
    }

    [Fact]
    public async Task Nz_gets_no_labelled_zones_so_its_picker_stays_as_it_was()
    {
        // The labelled, depot-scoped list is a US change and NZ was left
        // alone (Kevin, 27 Oct). An empty list here is what makes the chain
        // editor fall back to the bare number list NZ has always had, so NZ
        // needs no tenant knowledge of its own. Filtering NZ would have been
        // defensible, since its availability function tests the depot too,
        // but 545 of 24,068 active ticks on Urgent staging would have started
        // rendering greyed, which is a visible change nobody asked for.
        var lookups = await Svc(SeedBothTenants(), isUs: false).GetLookupsAsync();

        Assert.Empty(lookups.Zones);
        // And the list it does render is untouched: the NZ zone numbers are
        // still there, unfiltered.
        Assert.Contains(21, lookups.ZoneNumbers);
        Assert.Contains(22, lookups.ZoneNumbers);
        Assert.Contains(23, lookups.ZoneNumbers);
    }

    [Fact]
    public async Task The_bare_number_list_is_left_alone_for_the_older_modal()
    {
        // zoneNumbers is still the union over BulkZonePostcode and
        // BulkZoneSchedule. The older schedule modal reads it, and the chain
        // editor needs it to show a tick that no longer resolves.
        var lookups = await Svc(SeedBothTenants(), isUs: true).GetLookupsAsync();

        Assert.Contains(21, lookups.ZoneNumbers);
        Assert.Contains(22, lookups.ZoneNumbers);
    }
}
