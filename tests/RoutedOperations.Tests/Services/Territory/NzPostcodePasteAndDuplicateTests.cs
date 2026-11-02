using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Territory;
using RoutedOperations.Core.Application.Services.Territory;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// Pasting NZ postcodes into a zone, and duplicating a group (spec 3.2, 11.8).
///
/// Both of these fail silently rather than loudly, which is why they are
/// tested at the service rather than left to the screen:
///
///   * A postcode sitting in a DIFFERENT zone of the same group must be
///     reported, never moved. On Urgent production no postcode is in two zones
///     of one group (measured 30 Oct), and the rating function resolves a rate
///     by (group, postcode), so quietly moving one reprices every schedule
///     that ticks either zone. Nothing on screen would show that.
///   * The column is an int, so 0110 Whangarei is stored as 110 and 673 of
///     Urgent's 3,025 rows are that shape. A paste that does not fold "0110"
///     onto 110 creates a second row for the same place, and the rate a
///     booking gets then depends on which row the function reaches first.
///   * A duplicate must not inherit the original's schedules. The copy is a
///     new territory; attaching it to the original's schedules silently
///     changes what those schedules serve.
/// </summary>
public class NzPostcodePasteAndDuplicateTests
{
    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    /// <summary>NZ tenant: no "US" CountryCode claim, which is what switches
    /// the service onto the BulkZonePostcode side.</summary>
    private static TerritoryService Svc(DbContextOptions<DespatchContext> opts)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(opts));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(opts)));

        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new List<Claim>
            {
                new("CountryCode", "NZ"),
                new(ClaimTypes.Email, "kevin@urgent.co.nz"),
            })),
        };
        accessor.HttpContext.Returns(ctx);
        return new TerritoryService(factory, accessor);
    }

    /// <summary>
    /// Group 1 "BOP Regional" at depot 4, with zone 1 holding 0110 (stored as
    /// 110) and 3110, and zone 2 holding 3200. Group 2 exists only so the
    /// duplicate name check has something to collide with.
    /// </summary>
    private static DbContextOptions<DespatchContext> Seed()
    {
        var opts = NewOptions();
        using var db = new DynamicDespatchDbContext(opts);
        db.BulkZonePostcodeGroups.AddRange(
            new BulkZonePostcodeGroup { Id = 1, Name = "BOP Regional", DepotId = 4, ClientId = null },
            new BulkZonePostcodeGroup { Id = 2, Name = "Taken Name", DepotId = 4, ClientId = null });
        db.BulkZonePostcodes.AddRange(
            new BulkZonePostcode { Id = 1, PostcodeGroupId = 1, Zone = 1, PostCode = 110, Name = "Whangarei", DepotId = 4 },
            new BulkZonePostcode { Id = 2, PostcodeGroupId = 1, Zone = 1, PostCode = 3110, Name = "Tauranga", DepotId = 4 },
            new BulkZonePostcode { Id = 3, PostcodeGroupId = 1, Zone = 2, PostCode = 3200, Name = "Mount Maunganui", DepotId = 4 });
        db.SaveChanges();
        return opts;
    }

    // ─── PASTE ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_postcode_already_in_another_zone_of_the_group_is_reported_not_moved()
    {
        // 3200 is in zone 2. Pasting it into zone 1 must not move it: the rate
        // for that postcode in this group would change from zone 2's to zone
        // 1's for every schedule ticking either zone.
        var opts = Seed();
        var result = await Svc(opts).PasteNzPostcodesAsync(1, 1,
            new NzPostcodePasteRequest { Postcodes = new List<string> { "3200" } });

        Assert.Empty(result.Added);
        var skipped = Assert.Single(result.SkippedInOtherZone);
        Assert.Equal("3200", skipped.Code);
        Assert.Equal(2, skipped.Zone);
        Assert.Equal("Mount Maunganui", skipped.ZoneLabel);

        await using var db = new DynamicDespatchDbContext(opts);
        var row = await db.BulkZonePostcodes.SingleAsync(p => p.PostCode == 3200);
        Assert.Equal(2, row.Zone);
        Assert.Equal(3, await db.BulkZonePostcodes.CountAsync());
    }

    [Fact]
    public async Task A_leading_zero_code_folds_onto_the_int_already_stored()
    {
        // 0110 is stored as 110. "0110" must be recognised as already present,
        // not written again, or the same place ends up with two rows and the
        // rate depends on which one the function reaches first.
        var opts = Seed();
        var result = await Svc(opts).PasteNzPostcodesAsync(1, 1,
            new NzPostcodePasteRequest { Postcodes = new List<string> { "0110" } });

        Assert.Empty(result.Added);
        Assert.Equal(new[] { "0110" }, result.AlreadyInThisZone);

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(1, await db.BulkZonePostcodes.CountAsync(p => p.PostCode == 110));
    }

    [Fact]
    public async Task New_codes_are_written_padded_in_the_result_and_inherit_a_suburb()
    {
        // 0112 is new. The result reads back padded because that is the
        // spelling an operator typed and recognises, while the row stores 112.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            // Same postcode elsewhere in the tenant already carries a label,
            // which is where the new row's suburb comes from when the caller
            // sends none. BulkZonePostcode.Name carries it on 2,909 of
            // Urgent's 3,025 rows, which is why no lookup table is involved.
            pre.BulkZonePostcodes.Add(new BulkZonePostcode
            { Id = 9, PostcodeGroupId = 2, Zone = 1, PostCode = 112, Name = "Kamo", DepotId = 4 });
            await pre.SaveChangesAsync();
        }

        var result = await Svc(opts).PasteNzPostcodesAsync(1, 1,
            new NzPostcodePasteRequest { Postcodes = new List<string> { "0112" } });

        Assert.Equal(new[] { "0112" }, result.Added);

        await using var db = new DynamicDespatchDbContext(opts);
        var added = await db.BulkZonePostcodes.SingleAsync(p => p.PostcodeGroupId == 1 && p.PostCode == 112);
        Assert.Equal(1, added.Zone);
        Assert.Equal("Kamo", added.Name);
        // Inherits the group's depot, so a row cannot point somewhere the
        // group does not serve.
        Assert.Equal(4, added.DepotId);
    }

    [Fact]
    public async Task A_code_with_no_suburb_anywhere_is_written_blank_not_null()
    {
        // BulkZonePostcode.Name is NOT NULL on the live table, where the 116
        // rows with no suburb carry an empty string. A code nobody has labelled
        // yet has nothing to inherit, so writing NULL rejects the whole paste.
        // Found in the browser on 2026-10-30: pasting 999 into Auckland AH
        // Zones returned a 500 while every unit test here passed, because each
        // one happened to seed a label the new row could inherit.
        var opts = Seed();
        var result = await Svc(opts).PasteNzPostcodesAsync(1, 1,
            new NzPostcodePasteRequest { Postcodes = new List<string> { "999" } });

        Assert.Equal(new[] { "0999" }, result.Added);

        await using var db = new DynamicDespatchDbContext(opts);
        var added = await db.BulkZonePostcodes.SingleAsync(p => p.PostcodeGroupId == 1 && p.PostCode == 999);
        Assert.Equal(string.Empty, added.Name);
    }

    [Fact]
    public async Task One_paste_splits_into_added_already_here_elsewhere_and_ignored()
    {
        // The whole point of the bulk path: an operator pastes a block out of
        // a spreadsheet and has to be told which codes did what. Separators
        // are mixed on purpose, matching the US paste and the pickers.
        var opts = Seed();
        var result = await Svc(opts).PasteNzPostcodesAsync(1, 1,
            new NzPostcodePasteRequest
            {
                Postcodes = new List<string> { "0112, 3110\n3200;banana 99999" },
            });

        Assert.Equal(new[] { "0112" }, result.Added);
        Assert.Equal(new[] { "3110" }, result.AlreadyInThisZone);
        Assert.Equal(2, Assert.Single(result.SkippedInOtherZone).Zone);
        // Returned verbatim, so the operator sees what was in their paste
        // rather than guessing which entries vanished. 99999 is five digits,
        // which is a US zip, not an NZ postcode.
        Assert.Equal(new[] { "banana", "99999" }, result.Ignored);
    }

    [Fact]
    public async Task A_zone_of_zero_is_refused_because_no_tick_can_reach_it()
    {
        var opts = Seed();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Svc(opts).PasteNzPostcodesAsync(1, 0,
                new NzPostcodePasteRequest { Postcodes = new List<string> { "0112" } }));
        Assert.Contains("zone number is required", ex.Message);
    }

    // ─── DUPLICATE ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Duplicate_copies_zone_membership_and_leaves_the_original_alone()
    {
        var opts = Seed();
        var result = await Svc(opts).DuplicatePostcodeGroupAsync(1,
            new PostcodeGroupDuplicateRequest { Name = "BOP Regional (Zimmer)" });

        Assert.Equal(3, result.MembersCopied);
        Assert.Equal(2, result.ZonesCopied);
        Assert.Equal("BOP Regional (Zimmer)", result.Group.Name);

        await using var db = new DynamicDespatchDbContext(opts);
        var copyId = result.Group.Id;
        Assert.NotEqual(1, copyId);
        // Both zones and every code carried over, with the zone numbers kept:
        // a copy that renumbered zones would price differently from the
        // original it was made from.
        var copied = await db.BulkZonePostcodes.Where(p => p.PostcodeGroupId == copyId).ToListAsync();
        Assert.Equal(new[] { 110, 3110, 3200 }, copied.OrderBy(p => p.PostCode).Select(p => p.PostCode));
        Assert.Equal(new[] { 1, 1, 2 }, copied.OrderBy(p => p.PostCode).Select(p => p.Zone));
        Assert.Equal("Whangarei", copied.Single(p => p.PostCode == 110).Name);
        // The original is untouched.
        Assert.Equal(3, await db.BulkZonePostcodes.CountAsync(p => p.PostcodeGroupId == 1));
    }

    [Fact]
    public async Task Duplicate_does_not_inherit_the_originals_schedules()
    {
        // A schedule pointing at the original must keep pointing only at the
        // original. If the copy inherited the reference, that schedule would
        // start serving two territories without anyone choosing it.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.TblBulkRunScheduleDays.Add(new TblBulkRunScheduleDay
            {
                BulkRunScheduleId = 7447, ScheduleId = 694, DayOfWeek = 1, PostcodeGroupId = 1,
            });
            await pre.SaveChangesAsync();
        }

        var result = await Svc(opts).DuplicatePostcodeGroupAsync(1,
            new PostcodeGroupDuplicateRequest { Name = "BOP Regional (copy)" });

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(0, await db.TblBulkRunScheduleDays
            .CountAsync(d => d.PostcodeGroupId == result.Group.Id
                          || d.PickupPostcodeGroupId == result.Group.Id));
        Assert.Equal(1, await db.TblBulkRunScheduleDays.CountAsync(d => d.PostcodeGroupId == 1));
    }

    // ─── MAP PANEL ─────────────────────────────────────────────────────────

    [Fact]
    public async Task The_map_joins_postcodes_to_boundaries_on_the_padded_spelling()
    {
        // BulkZonePostcode.PostCode is an int so 0110 is stored as 110, while
        // ZipPolygon.Zip is the padded text. Joining on the raw int finds
        // nothing and the map comes back empty with no error.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.TblBulkRegions.Add(new TblBulkRegion
            { BulkRegionId = 4, Name = "Hamilton", Active = true, PickupLatitude = -37.78m, PickupLongitude = 175.28m });
            pre.ZipPolygons.AddRange(
                new ZipPolygon { ZipPolygonId = 1, Zip = "0110", Latitude = -35.72m, Longitude = 174.32m, Wkt = "POLYGON((174.3 -35.7, 174.4 -35.7, 174.4 -35.8, 174.3 -35.8, 174.3 -35.7))" },
                new ZipPolygon { ZipPolygonId = 2, Zip = "3110", Latitude = -37.68m, Longitude = 176.17m, Wkt = "POLYGON((176.1 -37.6, 176.2 -37.6, 176.2 -37.7, 176.1 -37.7, 176.1 -37.6))" });
            await pre.SaveChangesAsync();
        }

        var map = await Svc(opts).GetZoneMapAsync(1);

        Assert.Equal("Hamilton", map.DepotName);
        Assert.Equal(-37.78m, map.DepotLatitude);
        Assert.Equal(2, map.Shapes.Count);
        Assert.Equal(new[] { "0110", "3110" }, map.Shapes.Select(x => x.Code).OrderBy(x => x).ToArray());
        // The zone travels with the shape, which is what the map shades by.
        Assert.Equal(1, map.Shapes.Single(x => x.Code == "0110").Zone);
    }

    [Fact]
    public async Task A_postcode_with_no_boundary_is_named_rather_than_dropped()
    {
        // A map quietly missing two of a group's zones reads as broken. Named,
        // it reads as data yet to load, which is what it is: the boundaries
        // arrive with the yearly Census refresh.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.ZipPolygons.Add(new ZipPolygon
            { ZipPolygonId = 1, Zip = "0110", Latitude = -35.72m, Longitude = 174.32m, Wkt = "POLYGON((174.3 -35.7, 174.4 -35.7, 174.4 -35.8, 174.3 -35.8, 174.3 -35.7))" });
            await pre.SaveChangesAsync();
        }

        var map = await Svc(opts).GetZoneMapAsync(1);

        Assert.Single(map.Shapes);
        Assert.Equal(new[] { "3110", "3200" }, map.CodesWithNoShape.ToArray());
    }

    [Fact]
    public async Task A_group_with_no_members_gives_an_empty_map_rather_than_throwing()
    {
        var opts = Seed();
        var map = await Svc(opts).GetZoneMapAsync(2);
        Assert.Empty(map.Shapes);
        Assert.Empty(map.CodesWithNoShape);
    }

    [Fact]
    public async Task Duplicate_copies_polygon_memberships_and_the_original_keeps_them()
    {
        // Steve, 2026-10-31: a shape is a MEMBER of a zone in a group, not
        // owned by one. BulkZonePolygon is unique on (PostcodeGroupId,
        // PolygonId), so the same shape may be zone 4 in Auckland's group and
        // zone 2 in a client's group. The first cut read the superseded single
        // column tblBulkRunPolygon.PostcodeGroupId as ownership and refused to
        // copy anything, which is what this pins down.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.BulkRunPolygons.AddRange(
                new BulkRunPolygon { PolygonId = 41, Name = "Mount Coast", Active = true, CreatedBy = "seed" },
                new BulkRunPolygon { PolygonId = 42, Name = "Papamoa East", Active = true, CreatedBy = "seed" });
            pre.BulkZonePolygons.AddRange(
                new BulkZonePolygon { Id = 1, PostcodeGroupId = 1, PolygonId = 41, Zone = 1, Active = true, CreatedBy = "seed" },
                new BulkZonePolygon { Id = 2, PostcodeGroupId = 1, PolygonId = 42, Zone = 2, Active = true, CreatedBy = "seed" });
            await pre.SaveChangesAsync();
        }

        var result = await Svc(opts).DuplicatePostcodeGroupAsync(1,
            new PostcodeGroupDuplicateRequest { Name = "BOP Regional (shapes)" });

        Assert.Equal(2, result.PolygonsCopied);

        await using var db = new DynamicDespatchDbContext(opts);
        var copied = await db.BulkZonePolygons
            .Where(z => z.PostcodeGroupId == result.Group.Id)
            .OrderBy(z => z.PolygonId).ToListAsync();
        // Same shapes, same zones. The shape itself is not cloned, so the id
        // is carried across rather than replaced.
        Assert.Equal(new[] { 41, 42 }, copied.Select(z => z.PolygonId).ToArray());
        Assert.Equal(new[] { 1, 2 }, copied.Select(z => z.Zone).ToArray());
        Assert.All(copied, z => Assert.True(z.Active));
        // No polygon rows were created or moved: the shapes are shared.
        Assert.Equal(2, await db.BulkRunPolygons.CountAsync());
        Assert.Equal(2, await db.BulkZonePolygons.CountAsync(z => z.PostcodeGroupId == 1));
    }

    [Fact]
    public async Task An_inactive_polygon_membership_is_not_carried_into_the_copy()
    {
        // Removing a shape from a zone deactivates the membership rather than
        // deleting the shape, so copying it back would resurrect a placement
        // somebody deliberately took out.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.BulkRunPolygons.Add(
                new BulkRunPolygon { PolygonId = 41, Name = "Mount Coast", Active = true, CreatedBy = "seed" });
            pre.BulkZonePolygons.Add(
                new BulkZonePolygon { Id = 1, PostcodeGroupId = 1, PolygonId = 41, Zone = 1, Active = false, CreatedBy = "seed" });
            await pre.SaveChangesAsync();
        }

        var result = await Svc(opts).DuplicatePostcodeGroupAsync(1,
            new PostcodeGroupDuplicateRequest { Name = "BOP Regional (no shapes)" });

        Assert.Equal(0, result.PolygonsCopied);

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(0, await db.BulkZonePolygons.CountAsync(z => z.PostcodeGroupId == result.Group.Id));
    }

    [Fact]
    public async Task The_drawer_lists_a_groups_shapes_with_the_zone_each_one_joined()
    {
        // The chip has to say which zone, because the same shape appears in
        // another group under a different zone and the two lists would
        // otherwise look identical.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.BulkRunPolygons.Add(
                new BulkRunPolygon { PolygonId = 41, Name = "Mount Coast", Active = true, CreatedBy = "seed" });
            pre.BulkZonePolygons.AddRange(
                new BulkZonePolygon { Id = 1, PostcodeGroupId = 1, PolygonId = 41, Zone = 4, Active = true, CreatedBy = "seed" },
                new BulkZonePolygon { Id = 2, PostcodeGroupId = 2, PolygonId = 41, Zone = 2, Active = true, CreatedBy = "seed" });
            await pre.SaveChangesAsync();
        }

        var svc = Svc(opts);
        var first = await svc.GetPostcodeGroupDetailAsync(1);
        var second = await svc.GetPostcodeGroupDetailAsync(2);

        var a = Assert.Single(first.Polygons);
        Assert.Equal(41, a.PolygonId);
        Assert.Equal(4, a.Zone);
        Assert.Equal(1, a.MembershipId);

        var b = Assert.Single(second.Polygons);
        Assert.Equal(41, b.PolygonId);
        Assert.Equal(2, b.Zone);
        Assert.Equal(2, b.MembershipId);
    }

    [Fact]
    public async Task Duplicate_refuses_a_name_already_taken_on_the_same_depot_and_client()
    {
        // Group 2 "Taken Name" already sits on depot 4 with no client, and the
        // copy would land on depot 4 with no client too. Nothing on any screen
        // distinguishes the two rows, so picking the wrong one in the schedule
        // modal's picker is invisible afterwards.
        var opts = Seed();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Svc(opts).DuplicatePostcodeGroupAsync(1,
                new PostcodeGroupDuplicateRequest { Name = "Taken Name" }));
        Assert.Contains("already sits on this depot", ex.Message);

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(2, await db.BulkZonePostcodeGroups.CountAsync());
    }

    [Fact]
    public async Task Duplicate_allows_the_same_name_when_the_copy_goes_to_another_depot()
    {
        // Carrying a group to a new depot under its own name is the main thing
        // Duplicate is for, and the live data already works that way: 10 of
        // Urgent's 58 groups share a name, HelloFresh across seven depots and
        // Chilled Zones across three. A tenant-wide name check would refuse
        // exactly that, which is what the first cut did.
        var opts = Seed();
        var result = await Svc(opts).DuplicatePostcodeGroupAsync(1,
            new PostcodeGroupDuplicateRequest { Name = "Taken Name", DepotId = 8 });

        await using var db = new DynamicDespatchDbContext(opts);
        var copy = await db.BulkZonePostcodeGroups.SingleAsync(g => g.Id == result.Group.Id);
        Assert.Equal("Taken Name", copy.Name);
        Assert.Equal(8, copy.DepotId);
        Assert.Equal(2, await db.BulkZonePostcodeGroups.CountAsync(g => g.Name == "Taken Name"));
    }

    [Fact]
    public async Task Retargeting_the_copy_to_another_depot_moves_its_member_rows_too()
    {
        // Otherwise the copy's rows still point at the depot the original
        // served, and the availability function resolves them there.
        var opts = Seed();
        var result = await Svc(opts).DuplicatePostcodeGroupAsync(1,
            new PostcodeGroupDuplicateRequest { Name = "BOP Regional (Hamilton)", DepotId = 8 });

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(8, (await db.BulkZonePostcodeGroups.SingleAsync(g => g.Id == result.Group.Id)).DepotId);
        Assert.All(
            await db.BulkZonePostcodes.Where(p => p.PostcodeGroupId == result.Group.Id).ToListAsync(),
            p => Assert.Equal(8, p.DepotId));
    }

    [Fact]
    public async Task The_group_drawer_lists_each_zones_codes_padded_with_their_suburb()
    {
        // Spec 3.2: a zone row lists its postcodes. Before this the detail
        // only carried a count, so an operator could see that zone 1 had two
        // codes but not which.
        var opts = Seed();
        var detail = await Svc(opts).GetPostcodeGroupDetailAsync(1);

        var zone1 = detail.Zones.Single(z => z.Zone == 1);
        Assert.Equal(2, zone1.MemberCount);
        Assert.Equal(new[] { "0110", "3110" }, zone1.Members.Select(m => m.Code));
        Assert.Equal(new[] { 110, 3110 }, zone1.Members.Select(m => m.Value));
        Assert.Equal("Whangarei", zone1.Members.Single(m => m.Value == 110).Suburb);
    }
}
