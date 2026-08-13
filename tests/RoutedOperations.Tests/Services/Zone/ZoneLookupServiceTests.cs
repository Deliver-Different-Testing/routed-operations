using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Services.Zone;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Zone;

public class ZoneLookupServiceTests
{
    private static ZoneLookupService NewSvc(out Core.Domain.DynamicDespatchDbContext seed, string? countryCode)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var factory = CockpitTestHarness.Factory(opts);
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        if (countryCode is not null)
            ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("CountryCode", countryCode)
            }));
        accessor.HttpContext.Returns(ctx);
        return new ZoneLookupService(factory, accessor);
    }

    [Fact]
    public async Task GetRatingZones_NoClaimUsesNzPath()
    {
        var svc = NewSvc(out var seed, null);
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "Auckland", Active = true });
        // Empty postcodes -> skipped ("continue" branch).
        await seed.SaveChangesAsync();

        var result = await svc.GetRatingZonesAsync();

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetRatingZones_UsClaimUsesUsPath()
    {
        var svc = NewSvc(out var seed, "US");
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "LA", Active = true });
        await seed.SaveChangesAsync();

        var result = await svc.GetRatingZonesAsync();

        Assert.Empty(result); // no ZoneNames, so depot skipped.
    }

    [Fact]
    public async Task GetRatingZones_NzGroupsAndZeroPads()
    {
        var svc = NewSvc(out var seed, null);
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "Auckland", Active = true });
        seed.BulkZonePostcodeGroups.Add(new BulkZonePostcodeGroup { Id = 10, Name = "CBD", DepotId = 1 });
        seed.BulkZonePostcodes.AddRange(
            new BulkZonePostcode { Id = 1, DepotId = 1, Zone = 1, PostCode = 1010, Name = "n1", PostcodeGroupId = 10 },
            new BulkZonePostcode { Id = 2, DepotId = 1, Zone = 1, PostCode = 42, Name = "n2", PostcodeGroupId = 10 },
            new BulkZonePostcode { Id = 3, DepotId = 1, Zone = 2, PostCode = 2000, Name = "n3", PostcodeGroupId = null });
        await seed.SaveChangesAsync();

        var result = await svc.GetRatingZonesAsync();

        var depot = Assert.Single(result);
        Assert.Equal("NZ", depot.CountryCode);
        Assert.Equal("Auckland", depot.DepotName);
        Assert.Equal(3, depot.PostcodeCount);
        Assert.Equal(2, depot.Groups.Count);

        var grouped = depot.Groups.Single(g => g.GroupId == 10);
        Assert.Equal("CBD", grouped.GroupName);
        Assert.Contains("0042", grouped.Zones.SelectMany(z => z.Postcodes));
        Assert.Contains("1010", grouped.Zones.SelectMany(z => z.Postcodes));

        var unGrouped = depot.Groups.Single(g => g.GroupId is null);
        Assert.Equal("(no group)", unGrouped.GroupName);
        Assert.Contains("2000", unGrouped.Zones.SelectMany(z => z.Postcodes));
    }

    [Fact]
    public async Task GetRatingZones_NzGroupWithUnknownGroupIdUsesGroupLabelFallback()
    {
        var svc = NewSvc(out var seed, null);
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "Wellington", Active = true });
        seed.BulkZonePostcodes.Add(new BulkZonePostcode
        {
            Id = 1, DepotId = 1, Zone = 3, PostCode = 6011, Name = "n", PostcodeGroupId = 999,
        });
        await seed.SaveChangesAsync();

        var result = await svc.GetRatingZonesAsync();

        var group = Assert.Single(result[0].Groups);
        Assert.Equal("Group 999", group.GroupName);
    }

    [Fact]
    public async Task GetRatingZones_UsFlattensZoneZipsAndGroupsByGroupIdPlusZoneName()
    {
        var svc = NewSvc(out var seed, "US");
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "SF", Active = true });
        var zn1 = new ZoneName { ZoneNameId = 1, ZoneName1 = "North", LocationId = 1 };
        var zn2 = new ZoneName { ZoneNameId = 2, ZoneName1 = "South", LocationId = 1 };
        seed.ZoneNames.AddRange(zn1, zn2);
        seed.ZoneZips.AddRange(
            new ZoneZip { ZoneZipId = 1, ZoneNameId = 1, ZoneNumber = 1, Zip = "94100", ZoneZipGroupId = 5 },
            new ZoneZip { ZoneZipId = 2, ZoneNameId = 1, ZoneNumber = 1, Zip = "94101", ZoneZipGroupId = 5 },
            new ZoneZip { ZoneZipId = 3, ZoneNameId = 2, ZoneNumber = 2, Zip = "94200", ZoneZipGroupId = null },
            new ZoneZip { ZoneZipId = 4, ZoneNameId = 2, ZoneNumber = 2, Zip = "", ZoneZipGroupId = null }); // empty zip filtered
        await seed.SaveChangesAsync();

        var result = await svc.GetRatingZonesAsync();

        var depot = Assert.Single(result);
        Assert.Equal("US", depot.CountryCode);
        Assert.Equal(2, depot.Groups.Count);
        var grouped = depot.Groups.Single(g => g.GroupId == 5);
        Assert.Equal("Group 5", grouped.GroupName);
        Assert.Equal("North", grouped.ZoneName);
        Assert.Contains("94100", grouped.Zones.SelectMany(z => z.Postcodes));
        Assert.Contains("94101", grouped.Zones.SelectMany(z => z.Postcodes));
        var solo = depot.Groups.Single(g => g.GroupId is null);
        Assert.Equal("(no group)", solo.GroupName);
        Assert.Equal("South", solo.ZoneName);
        Assert.Single(solo.Zones.Single().Postcodes);
    }

    [Fact]
    public async Task GetRatingZones_UsDepotWithNoZipsIsSkipped()
    {
        var svc = NewSvc(out var seed, "US");
        seed.TblBulkRegions.Add(new TblBulkRegion { BulkRegionId = 1, Name = "Empty", Active = true });
        await seed.SaveChangesAsync();

        var result = await svc.GetRatingZonesAsync();

        Assert.Empty(result);
    }
}
