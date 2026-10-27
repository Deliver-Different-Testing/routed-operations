using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Territory;
using RoutedOperations.Core.Application.Services.Territory;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// Pasting ZIPs into a US zone.
///
/// The Zones tab adds one ZIP per request, so Ruth's Cheetah file is 602 form
/// submissions across eight zones. This is the bulk path, and almost
/// everything it has to get right fails silently rather than loudly:
///
///   * The zone NUMBER is the key a schedule leg tick resolves by (decision
///     D1 of the coverage spec). A row written without it, or with the wrong
///     one, is simply never reached, and the schedule quietly serves nothing.
///   * A coverage row must not move a price. The rater reads the congestion
///     flag off ZoneZip without caring which zone the row is in, so one
///     coverage row with the flag set would add a congestion charge to a ZIP
///     the tenant already prices (spec 2.1).
///   * Two zones at one depot may share a number, and that is legitimate: the
///     tick covers both. But it widens coverage, so it is opt-in. Letting it
///     happen by accident is how a schedule starts serving an area nobody
///     chose.
///   * Spelling. Every US tenant stores a 5-character ZIP with the leading
///     zero kept (measured 27 Oct: OTG 1,269 of 1,269, Cheetah 1,281 of
///     1,281). Mixing spellings would put one ZIP in different zones
///     depending on how it was typed, so that case refuses.
/// </summary>
public class ZoneZipPasteTests
{
    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    private static TerritoryService Svc(DbContextOptions<DespatchContext> opts)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(opts));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(opts)));

        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new List<Claim>
        {
            new("CountryCode", "US"),
            new(ClaimTypes.Email, "kevin@urgent.co.nz"),
        }));
        accessor.HttpContext.Returns(ctx);
        return new TerritoryService(factory, accessor);
    }

    /// <summary>Zone 1 and zone 2 both sit at depot 29. Zone 3 has no depot.</summary>
    private static DbContextOptions<DespatchContext> Seed()
    {
        var opts = NewOptions();
        using var db = new DynamicDespatchDbContext(opts);
        db.ZoneNames.AddRange(
            new ZoneName { ZoneNameId = 1, ZoneName1 = "KC Mon+Thu", LocationId = 29 },
            new ZoneName { ZoneNameId = 2, ZoneName1 = "KC OUTER", LocationId = 29 },
            new ZoneName { ZoneNameId = 3, ZoneName1 = "GRANDVIEW", LocationId = null });
        db.ZoneZips.AddRange(
            // Already in the target zone.
            new ZoneZip { ZoneZipId = 1, Zip = "64030", ZoneNumber = 5, ZoneNameId = 1 },
            // In ANOTHER zone at the same depot, on number 9.
            new ZoneZip { ZoneZipId = 2, Zip = "65201", ZoneNumber = 9, ZoneNameId = 2 });
        db.SaveChanges();
        return opts;
    }

    private static ZoneZipPasteRequest Req(string zips, int number = 5, bool shared = false) =>
        new() { Zips = new List<string> { zips }, ZoneNumber = number, AllowSharedNumber = shared };

    [Fact]
    public async Task Pads_a_four_digit_zip_to_five()
    {
        var res = await Svc(Seed()).PasteZoneZipsAsync(1, Req("7030"));

        // Every US tenant keeps the leading zero, so "7030" means 07030.
        Assert.Equal(new[] { "07030" }, res.Added.ToArray());
    }

    [Fact]
    public async Task Splits_on_every_separator_the_pickers_accept_and_drops_duplicates()
    {
        var res = await Svc(Seed()).PasteZoneZipsAsync(1, Req("63501, 64429 64430;63501\n64431"));

        Assert.Equal(new[] { "63501", "64429", "64430", "64431" }, res.Added.OrderBy(z => z).ToArray());
    }

    [Fact]
    public async Task Reports_what_it_could_not_read_rather_than_dropping_it_quietly()
    {
        var res = await Svc(Seed()).PasteZoneZipsAsync(1, Req("63501, DOS NOT ON FILE, 1234567"));

        Assert.Equal(new[] { "63501" }, res.Added.ToArray());
        // Dane's file carries 116 "DOS NOT ON FILE" rows, so an operator needs
        // to see them listed rather than discover a count that does not add up.
        Assert.Contains("DOS", res.Ignored);
        Assert.Contains("1234567", res.Ignored);
    }

    [Fact]
    public async Task Says_what_was_already_here_and_does_not_write_it_twice()
    {
        var opts = Seed();
        var res = await Svc(opts).PasteZoneZipsAsync(1, Req("64030, 63501"));

        Assert.Equal(new[] { "63501" }, res.Added.ToArray());
        Assert.Equal(new[] { "64030" }, res.AlreadyInThisZone.ToArray());

        using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(1, await db.ZoneZips.CountAsync(z => z.ZoneNameId == 1 && z.Zip == "64030"));
    }

    [Fact]
    public async Task Adds_a_zip_that_is_already_in_another_zone_rather_than_moving_it()
    {
        var opts = Seed();
        await Svc(opts).PasteZoneZipsAsync(1, Req("65201"));

        using var db = new DynamicDespatchDbContext(opts);
        // On US a ZIP in one pricing zone plus any number of coverage zones is
        // the normal shape, and the rater matches lanes against the whole
        // list, so moving it would change what the tenant prices.
        Assert.Equal(1, await db.ZoneZips.CountAsync(z => z.Zip == "65201" && z.ZoneNameId == 2));
        Assert.Equal(1, await db.ZoneZips.CountAsync(z => z.Zip == "65201" && z.ZoneNameId == 1));
    }

    [Fact]
    public async Task Writes_the_zone_number_and_leaves_congestion_off()
    {
        var opts = Seed();
        await Svc(opts).PasteZoneZipsAsync(1, Req("63501", number: 5));

        using var db = new DynamicDespatchDbContext(opts);
        var added = await db.ZoneZips.SingleAsync(z => z.Zip == "63501");
        // The number is the key a tick resolves by; without it the row can
        // never be reached.
        Assert.Equal(5, added.ZoneNumber);
        // A coverage row never adds a congestion charge (spec 2.1).
        Assert.Equal(false, added.ApplyCongestion);
        // Nothing reads the zip-group id and Zip Groups stay hidden on US.
        Assert.Null(added.ZoneZipGroupId);
    }

    [Fact]
    public async Task Refuses_a_number_another_zone_at_the_same_depot_already_uses()
    {
        // Zone 2 at depot 29 holds number 9. Ticking 9 would then serve both.
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => Svc(Seed()).PasteZoneZipsAsync(1, Req("63501", number: 9)));

        Assert.Contains("9", ex.Message);
        Assert.Contains("KC OUTER", ex.Message);
        // And it says how to mean it on purpose.
        Assert.Contains("allowSharedNumber", ex.Message);
    }

    [Fact]
    public async Task Allows_the_shared_number_when_it_is_asked_for()
    {
        var res = await Svc(Seed()).PasteZoneZipsAsync(1, Req("63501", number: 9, shared: true));

        Assert.Equal(new[] { "63501" }, res.Added.ToArray());
    }

    [Fact]
    public async Task Writes_nothing_when_the_number_is_refused()
    {
        var opts = Seed();
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Svc(opts).PasteZoneZipsAsync(1, Req("63501, 64429", number: 9)));

        using var db = new DynamicDespatchDbContext(opts);
        Assert.False(await db.ZoneZips.AnyAsync(z => z.Zip == "63501" || z.Zip == "64429"));
    }

    [Fact]
    public async Task Does_not_apply_the_guard_to_a_zone_with_no_depot()
    {
        // A zone with no depot has no depot to collide at, and the
        // availability function could never match it either way.
        var res = await Svc(Seed()).PasteZoneZipsAsync(3, Req("63501", number: 9));

        Assert.Equal(new[] { "63501" }, res.Added.ToArray());
    }

    [Fact]
    public async Task Refuses_rather_than_mixing_spellings_on_a_tenant_that_strips_the_zero()
    {
        var opts = Seed();
        using (var db = new DynamicDespatchDbContext(opts))
        {
            // One unpadded row proves this tenant strips. Adding padded rows
            // would leave the same ZIP in different zones depending on how it
            // was typed, which is the one outcome worth stopping for.
            db.ZoneZips.Add(new ZoneZip { ZoneZipId = 9, Zip = "7030", ZoneNumber = 1, ZoneNameId = 2 });
            db.SaveChanges();
        }

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => Svc(opts).PasteZoneZipsAsync(1, Req("63501")));

        Assert.Contains("7030", ex.Message);
        Assert.Contains("spelling", ex.Message);
    }

    [Fact]
    public async Task Requires_a_zone_number()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Svc(Seed()).PasteZoneZipsAsync(1, Req("63501", number: 0)));
    }

    [Fact]
    public async Task Refuses_an_unknown_zone()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Svc(Seed()).PasteZoneZipsAsync(999, Req("63501")));
    }
}
