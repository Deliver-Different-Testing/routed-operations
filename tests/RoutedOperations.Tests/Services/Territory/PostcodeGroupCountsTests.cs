using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Territory;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// The counts on a postcode / zip group row.
///
/// Three of these encode a decision that is NOT visible from reading the
/// code, and each would be a silently wrong number on the operator's
/// screen rather than a crash:
///
///   * The member source is tenant-dependent. ONE table
///     (BulkZonePostcodeGroup) is the group on both tenants, but NZ
///     members are BulkZonePostcode and US members are ZoneZip. Counting
///     only BulkZonePostcode reads 0 for every group on a US tenant,
///     which looks like "the feature has no data" and is how the wrong
///     table got investigated twice.
///   * Delivery and pickup are counted APART, because a group can be
///     referenced on either side and plenty are pickup-only. Summing them
///     shows a heavily-used pickup group as unused, which invites someone
///     to change or delete it.
///   * Schedules are counted by distinct HEADER, not by day row. A
///     schedule carries up to seven day rows, so counting rows inflates
///     the figure several-fold and the operator cannot reconcile it with
///     the schedules list.
/// </summary>
public class PostcodeGroupCountsTests
{
    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    private static TerritoryService Svc(DbContextOptions<DespatchContext> opts, bool isUs)
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
        return new TerritoryService(factory, accessor);
    }

    /// <summary>One group, seeded with BOTH tenants' member rows, so a
    /// query that reads the wrong table still returns a non-zero number
    /// and the test fails on the value rather than on emptiness.</summary>
    private static DbContextOptions<DespatchContext> SeedBothMemberKinds()
    {
        var opts = NewOptions();
        using var db = new DynamicDespatchDbContext(opts);
        db.BulkZonePostcodeGroups.Add(new BulkZonePostcodeGroup { Id = 7, Name = "Chilled Zones" });

        // NZ members: three postcodes over two zones.
        db.BulkZonePostcodes.AddRange(
            new BulkZonePostcode { Id = 1, PostCode = 1010, Zone = 1, PostcodeGroupId = 7 },
            new BulkZonePostcode { Id = 2, PostCode = 1011, Zone = 1, PostcodeGroupId = 7 },
            new BulkZonePostcode { Id = 3, PostCode = 2010, Zone = 2, PostcodeGroupId = 7 });

        // US members: five zips over three zones.
        db.ZoneZips.AddRange(
            new ZoneZip { ZoneZipId = 1, Zip = "90001", ZoneNumber = 1, ZoneZipGroupId = 7 },
            new ZoneZip { ZoneZipId = 2, Zip = "90002", ZoneNumber = 1, ZoneZipGroupId = 7 },
            new ZoneZip { ZoneZipId = 3, Zip = "90003", ZoneNumber = 2, ZoneZipGroupId = 7 },
            new ZoneZip { ZoneZipId = 4, Zip = "90004", ZoneNumber = 3, ZoneZipGroupId = 7 },
            new ZoneZip { ZoneZipId = 5, Zip = "90005", ZoneNumber = 3, ZoneZipGroupId = 7 });

        db.SaveChanges();
        return opts;
    }

    [Fact]
    public async Task NZ_counts_postcode_members_not_zips()
    {
        var opts = SeedBothMemberKinds();
        var g = (await Svc(opts, isUs: false).GetPostcodeGroupsAsync()).Single();

        Assert.Equal(3, g.PostcodeCount);
        Assert.Equal(2, g.ZoneCount);
    }

    [Fact]
    public async Task US_counts_zip_members_not_postcodes()
    {
        // The regression this pins: BulkZonePostcodeGroup is shared, so a
        // US group is NOT empty - its members just live in ZoneZip.
        var opts = SeedBothMemberKinds();
        var g = (await Svc(opts, isUs: true).GetPostcodeGroupsAsync()).Single();

        Assert.Equal(5, g.PostcodeCount);
        Assert.Equal(3, g.ZoneCount);
    }

    [Fact]
    public async Task A_pickup_only_group_does_not_read_as_unused()
    {
        // Modelled on "PU Regional Tauranga Z1" on Urgent production: no
        // delivery schedule at all, and hundreds of pickup day rows. With
        // one combined column this group shows as 0 and looks safe to
        // delete.
        var opts = NewOptions();
        using (var db = new DynamicDespatchDbContext(opts))
        {
            db.BulkZonePostcodeGroups.Add(new BulkZonePostcodeGroup { Id = 11, Name = "PU Regional Tauranga Z1" });
            db.TblBulkRunScheduleDays.AddRange(
                Day(100, 501, dayOfWeek: 1, pickupGroup: 11),
                Day(101, 501, dayOfWeek: 2, pickupGroup: 11),
                Day(102, 502, dayOfWeek: 1, pickupGroup: 11));
            db.SaveChanges();
        }

        var g = (await Svc(opts, isUs: false).GetPostcodeGroupsAsync()).Single();

        Assert.Equal(0, g.DeliveryScheduleCount);
        // Two schedules, three day rows. Counting rows would say 3.
        Assert.Equal(2, g.PickupScheduleCount);
    }

    [Fact]
    public async Task A_schedule_using_one_group_on_both_sides_counts_on_both()
    {
        var opts = NewOptions();
        using (var db = new DynamicDespatchDbContext(opts))
        {
            db.BulkZonePostcodeGroups.Add(new BulkZonePostcodeGroup { Id = 12, Name = "Auckland AH Zones" });
            var d = Day(200, 601, dayOfWeek: 1, deliveryGroup: 12);
            d.PickupPostcodeGroupId = 12;
            db.TblBulkRunScheduleDays.Add(d);
            db.SaveChanges();
        }

        var g = (await Svc(opts, isUs: false).GetPostcodeGroupsAsync()).Single();

        Assert.Equal(1, g.DeliveryScheduleCount);
        Assert.Equal(1, g.PickupScheduleCount);
    }

    [Fact]
    public async Task Detail_reports_each_side_per_schedule_and_labels_the_zones()
    {
        var opts = NewOptions();
        using (var db = new DynamicDespatchDbContext(opts))
        {
            db.BulkZonePostcodeGroups.Add(new BulkZonePostcodeGroup { Id = 13, Name = "Std Regional Hamilton" });
            db.BulkRunScheduleHeaders.Add(new BulkRunScheduleHeader { ScheduleId = 701, Name = "Hamilton Morning" });
            db.BulkZonePostcodes.AddRange(
                new BulkZonePostcode { Id = 10, PostCode = 3200, Zone = 4, Name = "Outer town", PostcodeGroupId = 13 },
                new BulkZonePostcode { Id = 11, PostCode = 3204, Zone = 4, Name = null, PostcodeGroupId = 13 });
            db.TblBulkRunScheduleDays.AddRange(
                Day(300, 701, dayOfWeek: 1, deliveryGroup: 13),
                Day(301, 701, dayOfWeek: 2, deliveryGroup: 13),
                Day(302, 702, dayOfWeek: 1, pickupGroup: 13));
            db.SaveChanges();
        }

        var detail = await Svc(opts, isUs: false).GetPostcodeGroupDetailAsync(13);

        Assert.Equal(1, detail.Group.DeliveryScheduleCount);
        Assert.Equal(1, detail.Group.PickupScheduleCount);

        // The zone label is denormalised onto member rows on NZ and some
        // rows carry null, so the first non-empty one wins rather than
        // whichever row happens to sort first.
        var zone = Assert.Single(detail.Zones);
        Assert.Equal(4, zone.Zone);
        Assert.Equal("Outer town", zone.Label);
        Assert.Equal(2, zone.MemberCount);

        var delivery = detail.Schedules.Single(s => s.ScheduleId == 701);
        Assert.True(delivery.UsedForDelivery);
        Assert.False(delivery.UsedForPickup);
        Assert.Equal(2, delivery.DayCount);
        // Header name wins over the day row's own copy of it.
        Assert.Equal("Hamilton Morning", delivery.Name);

        var pickup = detail.Schedules.Single(s => s.ScheduleId == 702);
        Assert.False(pickup.UsedForDelivery);
        Assert.True(pickup.UsedForPickup);
    }

    [Fact]
    public async Task A_group_nothing_points_at_reports_zeros_rather_than_vanishing()
    {
        // Eight of the 68 groups on Urgent production are in this state.
        // They must still list, or an operator cannot find them to clean up.
        var opts = NewOptions();
        using (var db = new DynamicDespatchDbContext(opts))
        {
            db.BulkZonePostcodeGroups.Add(new BulkZonePostcodeGroup { Id = 14, Name = "New Chilled" });
            db.SaveChanges();
        }

        var g = (await Svc(opts, isUs: false).GetPostcodeGroupsAsync()).Single();

        Assert.Equal(0, g.PostcodeCount);
        Assert.Equal(0, g.ZoneCount);
        Assert.Equal(0, g.PolygonCount);
        Assert.Equal(0, g.DeliveryScheduleCount);
        Assert.Equal(0, g.PickupScheduleCount);
    }

    private static TblBulkRunScheduleDay Day(
        int bulkRunScheduleId,
        int scheduleId,
        short dayOfWeek,
        int? deliveryGroup = null,
        int? pickupGroup = null) => new()
        {
            BulkRunScheduleId = bulkRunScheduleId,
            ScheduleId = scheduleId,
            DayOfWeek = dayOfWeek,
            Name = $"day {bulkRunScheduleId}",
            PostcodeGroupId = deliveryGroup,
            PickupPostcodeGroupId = pickupGroup,
        };
}
