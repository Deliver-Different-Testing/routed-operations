using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Zone;
using RoutedOperations.Core.Application.Services.Zone;

namespace RoutedOperations.Tests.Controllers;

// Covers ZonesController.GetRatingPostcodes: read-only endpoint that returns
// the tenant's rating-geography (US=ZoneName/ZoneZip, NZ=BulkZonePostcode).
// Country switch is inside the service (tests over there cover both branches);
// the controller test verifies the { response = ... } envelope only.
// Auth policy RouteBuilder.Polygon is declarative.
public class ZonesControllerTests
{
    private static ZonesController NewCtl(string? country = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var accessor = ControllerTestHarness.Accessor(countryCode: country);
        var svc = new ZoneLookupService(ControllerTestHarness.Factory(opts), accessor);
        return new ZonesController(svc);
    }

    [Fact]
    public async Task GetRatingPostcodes_NzTenant_ReturnsWrappedEmptyList()
    {
        var ctl = NewCtl(country: null); // no CountryCode falls back to NZ path
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetRatingPostcodes());
        var list = Assert.IsAssignableFrom<IEnumerable<RatingZoneDepotDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }

    [Fact]
    public async Task GetRatingPostcodes_UsTenant_ReturnsWrappedEmptyList()
    {
        var ctl = NewCtl(country: "US");
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetRatingPostcodes());
        var list = Assert.IsAssignableFrom<IEnumerable<RatingZoneDepotDto>>(
            ControllerTestHarness.ExtractResponse(ok)!);
        Assert.Empty(list);
    }
}
