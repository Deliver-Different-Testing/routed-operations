using System.Net;
using RoutedOperations.Core.Application.Dtos.BulkImport.Address;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.BulkImport;

// Covers AddressService end-to-end. HereGeocodeService is a concrete class
// with non-virtual methods, so it can't be NSubstitute'd directly - instead
// each test wires a real HereGeocodeService over a fake HttpMessageHandler
// so the HERE branch of Geocode() executes the "no match" path (returns a
// null-coord placeholder) without any network call.
public class AddressServiceTests
{
    // Trivial HttpMessageHandler that always returns the same canned status.
    private sealed class FakeHandler : HttpMessageHandler
    {
        private readonly HttpStatusCode _status;
        private readonly string _body;
        public FakeHandler(HttpStatusCode status = HttpStatusCode.InternalServerError, string body = "")
        {
            _status = status;
            _body = body;
        }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(_status)
            {
                Content = new StringContent(_body)
            });
    }

    private static HereGeocodeService NewHereSvc(HttpStatusCode status = HttpStatusCode.InternalServerError, string body = "")
    {
        var client = new HttpClient(new FakeHandler(status, body));
        // HereGeocodeService's GeocodeAsync early-returns null when the API
        // key is empty, which is exactly what we want for the tests that
        // exercise Geocode()'s "no result" path.
        var settings = new AppSettings { HereMapsApiKey = string.Empty };
        return new HereGeocodeService(client, settings);
    }

    private static AddressService NewSvc(
        out DynamicDespatchDbContext seed,
        string countryCode = "US",
        HttpStatusCode? hereStatus = null)
    {
        var opts = BulkImportTestHarness.NewOptions();
        seed = BulkImportTestHarness.Context(opts);
        var accessor = BulkImportTestHarness.Accessor(countryCode);
        var cache = BulkImportTestHarness.Cache(accessor);
        var here = NewHereSvc(hereStatus ?? HttpStatusCode.InternalServerError);
        return new AddressService(BulkImportTestHarness.Factory(opts), accessor, here, cache);
    }

    // ---------------- GetSuburbs -----------------

    [Fact]
    public async Task GetSuburbs_UsTenant_ReturnsEmptyList()
    {
        var svc = NewSvc(out var seed, countryCode: "US");
        seed.TucSuburbs.Add(new TucSuburb { UcsuId = 1, UcsuName = "Ignored", City = "X", PostCode = "1000", Alias = "", GoogleSuburbAlias = "" });
        await seed.SaveChangesAsync();

        var resp = await svc.GetSuburbs(Guid.NewGuid());

        Assert.True(resp.Success);
        Assert.Empty(resp.Suburbs);
    }

    [Fact]
    public async Task GetSuburbs_NzTenant_ProjectsAndOrders()
    {
        var svc = NewSvc(out var seed, countryCode: "NZ");
        seed.TucSuburbs.AddRange(
            new TucSuburb { UcsuId = 1, UcsuName = "Zeta", City = "Auckland", PostCode = "1010", Alias = "", GoogleSuburbAlias = "" },
            new TucSuburb { UcsuId = 2, UcsuName = "Alpha", City = "  ", PostCode = "23", Alias = ",", GoogleSuburbAlias = "GAlias" });
        await seed.SaveChangesAsync();

        var resp = await svc.GetSuburbs(Guid.NewGuid());

        Assert.True(resp.Success);
        var names = resp.Suburbs.Select(s => s.Name).ToArray();
        Assert.Equal(new[] { "Alpha", "Zeta" }, names);
        var alpha = resp.Suburbs.Single(s => s.Name == "Alpha");
        Assert.Null(alpha.City);     // whitespace collapses to null
        Assert.Equal("0023", alpha.PostCode); // pad-left 4
        Assert.Null(alpha.Alias);    // "," collapses to null
        Assert.Equal("GAlias", alpha.GoogleAlias);
    }

    [Fact]
    public async Task GetSuburbs_CachedResponse_IsReturnedOnSecondCall()
    {
        var opts = BulkImportTestHarness.NewOptions();
        var accessor = BulkImportTestHarness.Accessor("NZ");
        var cache = BulkImportTestHarness.Cache(accessor);
        var svc = new AddressService(BulkImportTestHarness.Factory(opts), accessor, NewHereSvc(), cache);

        var mid = Guid.NewGuid();
        var first = await svc.GetSuburbs(mid);
        Assert.Empty(first.Suburbs);

        // Seed after warm.
        using (var seed = BulkImportTestHarness.Context(opts))
        {
            seed.TucSuburbs.Add(new TucSuburb { UcsuId = 1, UcsuName = "Post", City = "X", PostCode = "1000", Alias = "", GoogleSuburbAlias = "" });
            await seed.SaveChangesAsync();
        }

        var second = await svc.GetSuburbs(mid);
        Assert.Empty(second.Suburbs); // cached
    }

    // ---------------- GetZipCodes -----------------

    [Fact]
    public async Task GetZipCodes_NzTenant_ReturnsEmpty()
    {
        var svc = NewSvc(out _, countryCode: "NZ");
        var resp = await svc.GetZipCodes(Guid.NewGuid());
        Assert.True(resp.Success);
        Assert.Empty(resp.ZipCodes);
    }

    [Fact]
    public async Task GetZipCodes_UsTenant_ProjectsAndOrders()
    {
        var svc = NewSvc(out var seed, countryCode: "US");
        var zone = new ZoneName { ZoneNameId = 1, ZoneName1 = "ZN" };
        seed.ZoneNames.Add(zone);
        seed.ZoneZips.AddRange(
            new ZoneZip { ZoneZipId = 1, ZoneNumber = 2, ZoneNameId = 1, ZoneName = zone, Zip = "10001", ClientId = 5 },
            new ZoneZip { ZoneZipId = 2, ZoneNumber = 1, ZoneNameId = 1, ZoneName = zone, Zip = "10002", ClientId = null });
        await seed.SaveChangesAsync();

        var resp = await svc.GetZipCodes(Guid.NewGuid());

        Assert.Equal(new[] { 1, 2 }, resp.ZipCodes.Select(z => z.ZoneNumber ?? 0).ToArray());
        Assert.All(resp.ZipCodes, z => Assert.Equal("ZN", z.ZoneName));
    }

    // ---------------- GetRegions -----------------

    [Fact]
    public async Task GetRegions_FiltersInactiveAndOrdersByName()
    {
        var svc = NewSvc(out var seed, countryCode: "US");
        seed.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 1, Name = "Zeta", Active = true, FromCompany = "ZCo", FromAddress = "Z1", AddressLine5 = "C1", AddressLine6 = "S1", AddressLine7 = "Z1" },
            new TblBulkRegion { BulkRegionId = 2, Name = "Alpha", Active = true },
            new TblBulkRegion { BulkRegionId = 3, Name = "Inactive", Active = false });
        await seed.SaveChangesAsync();

        var resp = await svc.GetRegions(Guid.NewGuid());

        Assert.True(resp.Success);
        Assert.Equal(new[] { "Alpha", "Zeta" }, resp.Regions.Select(r => r.Name).ToArray());
        var zeta = resp.Regions.Single(r => r.Name == "Zeta");
        Assert.Equal("ZCo", zeta.FromCompany);
        Assert.Equal("C1", zeta.FromCity);
    }

    // ---------------- GetZipPolygons -----------------

    [Fact]
    public async Task GetZipPolygons_FiltersNullAndEmptyAndDistinct()
    {
        var svc = NewSvc(out var seed, countryCode: "US");
        seed.ZipPolygons.AddRange(
            new ZipPolygon { ZipPolygonId = 1, Zip = "10001" },
            new ZipPolygon { ZipPolygonId = 2, Zip = "10001" }, // dup
            new ZipPolygon { ZipPolygonId = 3, Zip = "" },      // empty
            new ZipPolygon { ZipPolygonId = 4, Zip = null },    // null
            new ZipPolygon { ZipPolygonId = 5, Zip = "10002" });
        await seed.SaveChangesAsync();

        var resp = await svc.GetZipPolygons(Guid.NewGuid());

        Assert.True(resp.Success);
        Assert.Equal(new[] { "10001", "10002" }, resp.Zips.OrderBy(z => z).ToArray());
    }

    // ---------------- Geocode -----------------

    [Fact]
    public async Task Geocode_UsTenant_NoDbHitAndHereFails_ReturnsUnresolvedPlaceholder()
    {
        // Empty DB + HERE handler that returns 500 -> HereGeocodeService throws
        // per its catch handler and returns null, so the row emits an
        // unresolved placeholder (null coords, GeoType=0).
        var svc = NewSvc(out _, countryCode: "US");

        var input = new AddressDto { Address = "500 Main St", City = "NYC", ZipCode = "10001" };
        var req = new GeocodeRequest { Addresses = new List<AddressDto> { input } };

        var resp = await svc.Geocode(req);

        Assert.True(resp.Success);
        Assert.Single(resp.Addresses);
        var dto = resp.Addresses.First();
        Assert.Null(dto.Latitude);
        Assert.Null(dto.Longitude);
        Assert.Equal(0, dto.GeoType);
    }

    [Fact]
    public async Task Geocode_NzTenant_NoDbHitAndHereFails_ReturnsUnresolvedPlaceholder()
    {
        var svc = NewSvc(out _, countryCode: "NZ");
        var input = new AddressDto { Address = "12 Queen St", Suburb = "Auckland", PostCode = "1010" };
        var req = new GeocodeRequest { Addresses = new List<AddressDto> { input } };

        var resp = await svc.Geocode(req);

        Assert.True(resp.Success);
        Assert.Single(resp.Addresses);
    }

    [Fact]
    public async Task Geocode_UsTenant_BlankInputSkipped_ProducesPlaceholder()
    {
        // Blank Address -> filtered out of addressesToGeocode, but the output
        // list still preserves index alignment.
        var svc = NewSvc(out _, countryCode: "US");
        var req = new GeocodeRequest
        {
            Addresses = new List<AddressDto> { new AddressDto { Address = "", City = "NYC", ZipCode = "10001" } }
        };

        var resp = await svc.Geocode(req);

        Assert.Single(resp.Addresses);
        Assert.Null(resp.Addresses.First().Latitude);
    }

    [Fact]
    public async Task Geocode_UsTenant_MatchesFromTblBulkJobsCache()
    {
        var svc = NewSvc(out var seed, countryCode: "US");
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1,
            BookDate = DateTime.Today,
            JobNumber = "J1",
            FromAddress = "500 Main St",
            FromCompany = "Sender",
            PickupAddressLine5 = "NYC",
            PickupAddressLine6 = "NY",
            PickupAddressLine7 = "10001",
            PickUpLatitude = "40.71",
            PickUpLongitude = "-74.01",
            FromGeoType = 1,
            // ToAddress is required for the second half of the Union - fill with
            // sentinel values so the row survives the where-clause.
            ToAddress = "irrelevant",
            ToCompany = "",
            DeliveryAddressLine5 = "OtherCity",
            DeliveryAddressLine6 = "NJ",
            DeliveryAddressLine7 = "07000",
            DeliveryLatitude = "0",
            DeliveryLongitude = "0"
        });
        await seed.SaveChangesAsync();

        var input = new AddressDto { Address = "500 Main St", City = "NYC", ZipCode = "10001" };
        var req = new GeocodeRequest { Addresses = new List<AddressDto> { input } };

        var resp = await svc.Geocode(req);

        var dto = resp.Addresses.First();
        Assert.Equal("40.71", dto.Latitude);
        Assert.Equal("-74.01", dto.Longitude);
    }

    // ---------------- GetPostcodesByDepotAsync -----------------

    [Fact]
    public async Task GetPostcodesByDepotAsync_UsTenant_ReturnsEmpty()
    {
        var svc = NewSvc(out _, countryCode: "US");
        var resp = await svc.GetPostcodesByDepotAsync(Guid.NewGuid());
        Assert.True(resp.Success);
        Assert.Empty(resp.Depots);
    }

    [Fact]
    public async Task GetPostcodesByDepotAsync_NzTenant_GroupsByDepot()
    {
        var svc = NewSvc(out var seed, countryCode: "NZ");
        var depotA = new TblBulkRegion { BulkRegionId = 1, Name = "Auckland" };
        var depotB = new TblBulkRegion { BulkRegionId = 2, Name = "Wellington" };
        seed.TblBulkRegions.AddRange(depotA, depotB);
        seed.BulkZonePostcodes.AddRange(
            new BulkZonePostcode { Id = 1, PostCode = 1010, DepotId = 1, Depot = depotA, PostcodeGroupId = null },
            new BulkZonePostcode { Id = 2, PostCode = 1020, DepotId = 1, Depot = depotA, PostcodeGroupId = null },
            new BulkZonePostcode { Id = 3, PostCode = 6011, DepotId = 2, Depot = depotB, PostcodeGroupId = null },
            new BulkZonePostcode { Id = 4, PostCode = 9999, DepotId = 1, Depot = depotA, PostcodeGroupId = 42 } // grouped -> excluded
        );
        await seed.SaveChangesAsync();

        var resp = await svc.GetPostcodesByDepotAsync(Guid.NewGuid());

        Assert.True(resp.Success);
        var byName = resp.Depots.ToDictionary(d => d.Name, d => d.Postcodes.OrderBy(p => p).ToArray());
        Assert.Equal(new[] { "1010", "1020" }, byName["Auckland"]);
        Assert.Equal(new[] { "6011" }, byName["Wellington"]);
    }

    // ---------------- GetZipCodesByLocationAsync -----------------

    [Fact]
    public async Task GetZipCodesByLocationAsync_GroupsByLocation()
    {
        var svc = NewSvc(out var seed, countryCode: "US");
        var loc1 = new TblBulkRegion { BulkRegionId = 10, Name = "Depot1" };
        var loc2 = new TblBulkRegion { BulkRegionId = 20, Name = "Depot2" };
        seed.TblBulkRegions.AddRange(loc1, loc2);
        var zn1 = new ZoneName { ZoneNameId = 1, ZoneName1 = "z1", LocationId = 10, Location = loc1 };
        var zn2 = new ZoneName { ZoneNameId = 2, ZoneName1 = "z2", LocationId = 20, Location = loc2 };
        seed.ZoneNames.AddRange(zn1, zn2);
        seed.ZoneZips.AddRange(
            new ZoneZip { ZoneZipId = 1, ZoneNameId = 1, ZoneName = zn1, Zip = "A" },
            new ZoneZip { ZoneZipId = 2, ZoneNameId = 1, ZoneName = zn1, Zip = "B" },
            new ZoneZip { ZoneZipId = 3, ZoneNameId = 2, ZoneName = zn2, Zip = "C" });
        await seed.SaveChangesAsync();

        var resp = await svc.GetZipCodesByLocationAsync(Guid.NewGuid());

        Assert.True(resp.Success);
        var d1 = resp.Locations.Single(l => l.Id == 10);
        Assert.Equal(new[] { "A", "B" }, d1.ZipCodes.OrderBy(z => z).ToArray());
        Assert.Equal(new[] { "C" }, resp.Locations.Single(l => l.Id == 20).ZipCodes.ToArray());
    }

    // ---------------- SortPostcodesByRegionAsync -----------------

    [Fact]
    public async Task SortPostcodesByRegionAsync_UsTenant_ReturnsErrorMessage()
    {
        var svc = NewSvc(out _, countryCode: "US");
        var req = new SortPostcodesByRegionRequest { Postcodes = new[] { "1010" } };

        var resp = await svc.SortPostcodesByRegionAsync(req);

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "This endpoint is only available for NZ tenants");
    }

    [Fact]
    public async Task SortPostcodesByRegionAsync_InvalidPostcode_ReturnsError()
    {
        var svc = NewSvc(out _, countryCode: "NZ");
        var req = new SortPostcodesByRegionRequest { Postcodes = new[] { "not-a-number" } };

        var resp = await svc.SortPostcodesByRegionAsync(req);

        Assert.Contains(resp.Messages, m => m.Message == "Invalid postcode.");
    }

    [Fact]
    public async Task SortPostcodesByRegionAsync_UnknownPostcode_BucketsAsUnassigned()
    {
        var svc = NewSvc(out _, countryCode: "NZ");
        var req = new SortPostcodesByRegionRequest { Postcodes = new[] { "9999" } };

        var resp = await svc.SortPostcodesByRegionAsync(req);

        Assert.True(resp.Success);
        var group = resp.Depots.Single();
        Assert.Equal(0, group.Id);
        Assert.Equal("Unassigned", group.Name);
        Assert.Equal(new[] { "9999" }, group.Postcodes.ToArray());
    }

    [Fact]
    public async Task SortPostcodesByRegionAsync_GroupsByResolvedDepot()
    {
        var svc = NewSvc(out var seed, countryCode: "NZ");
        var depot = new TblBulkRegion { BulkRegionId = 1, Name = "Auckland" };
        seed.TblBulkRegions.Add(depot);
        seed.BulkZonePostcodes.Add(new BulkZonePostcode { Id = 1, PostCode = 1010, DepotId = 1, Depot = depot, PostcodeGroupId = null });
        await seed.SaveChangesAsync();

        var req = new SortPostcodesByRegionRequest { Postcodes = new[] { "1010", "9999" } };
        var resp = await svc.SortPostcodesByRegionAsync(req);

        Assert.True(resp.Success);
        var byName = resp.Depots.ToDictionary(d => d.Name, d => d.Postcodes.ToArray());
        Assert.Equal(new[] { "1010" }, byName["Auckland"]);
        Assert.Equal(new[] { "9999" }, byName["Unassigned"]);
    }

    // ---------------- Format sanity via AddressUtility (touched inside svc) -----

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("  ", null)]
    [InlineData("abc", null)]
    [InlineData("0", null)]
    [InlineData("42", "0042")]
    [InlineData(" 1010 ", "1010")]
    public void AddressUtility_FormatPostCode_Trivia(string input, string expected)
    {
        Assert.Equal(expected, AddressUtility.FormatPostCode(input));
    }
}
