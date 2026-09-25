using System.Net.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.BulkImport.Address;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Controllers;

// Covers AddressController: NZ/US branching happens inside AddressService (the
// service's own tests cover both branches); the controller tests focus on the
// response envelope, ModelState short-circuits, and the HERE geocode wrapper's
// "found=false" fallback when the API key is unconfigured (safe default in
// test env).
public class AddressControllerTests
{
    private static AddressController NewCtl(string? countryCode = null)
    {
        var opts = ControllerTestHarness.NewOptions();
        var accessor = ControllerTestHarness.Accessor(countryCode: countryCode, contactId: "3");
        var cache = ControllerTestHarness.Cache(accessor);
        var here = new HereGeocodeService(new HttpClient(), new AppSettings()); // empty API key => geocode returns null
        var svc = new AddressService(ControllerTestHarness.Factory(opts), accessor, here, cache);
        var logger = Substitute.For<ILogger<AddressController>>();
        var ctl = new AddressController(svc, here, logger);
        ControllerTestHarness.AttachHttpContext(ctl,
            contactId: "3", countryCode: countryCode);
        return ctl;
    }

    // ── Ref-data endpoints (NZ / US branching lives in the service) ───────

    [Fact]
    public async Task GetSuburbs_ReturnsOkSuburbsResponse()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetSuburbs());
        var resp = Assert.IsType<SuburbsResponse>(ok.Value!);
        Assert.True(resp.Success);
    }

    [Fact]
    public async Task GetZipCodes_ReturnsOkZipCodesResponse()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetZipCodes());
        var resp = Assert.IsType<ZipCodesResponse>(ok.Value!);
        Assert.True(resp.Success);
    }

    [Fact]
    public async Task GetRegions_ReturnsOkRegionsResponse()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetRegions());
        var resp = Assert.IsType<RegionsResponse>(ok.Value!);
        Assert.True(resp.Success);
    }

    [Fact]
    public async Task GetZipPolygons_ReturnsOkZipPolygonsResponse()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetZipPolygons());
        var resp = Assert.IsType<ZipPolygonsResponse>(ok.Value!);
        Assert.True(resp.Success);
    }

    [Fact]
    public async Task GetPostcodesByDepot_NonNzTenant_ReturnsEmptyDepots()
    {
        var ctl = NewCtl(countryCode: "US");
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetPostcodesByDepot());
        var resp = Assert.IsType<SortPostcodesByRegionResponse>(ok.Value!);
        Assert.True(resp.Success);
        Assert.Empty(resp.Depots);
    }

    [Fact]
    public async Task GetZipCodesByLocation_ReturnsOkResponse()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.GetZipCodesByLocation());
        var resp = Assert.IsType<SortZipCodesByLocationResponse>(ok.Value!);
        Assert.True(resp.Success);
    }

    // ── Geocode ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Geocode_InvalidModelState_ReturnsBadRequest()
    {
        var ctl = NewCtl();
        ctl.ModelState.AddModelError("Addresses", "required");
        var req = new GeocodeRequest { Addresses = new List<AddressDto>() };
        Assert.IsType<BadRequestObjectResult>(await ctl.Geocode(req));
    }

    // ── HERE proxy wrappers ───────────────────────────────────────────────

    [Fact]
    public async Task ReverseGeocode_UnconfiguredApiKey_ReturnsFoundFalse()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.ReverseGeocode(-36.85, 174.76));
        var payload = ok.Value!;
        var found = payload.GetType().GetProperty("found")!.GetValue(payload);
        Assert.Equal(false, found);
    }

    [Fact]
    public async Task ForwardGeocode_UnconfiguredApiKey_ReturnsFoundFalse()
    {
        var ctl = NewCtl();
        var ok = Assert.IsType<OkObjectResult>(await ctl.ForwardGeocode("100 Queen St"));
        var payload = ok.Value!;
        var found = payload.GetType().GetProperty("found")!.GetValue(payload);
        Assert.Equal(false, found);
    }
}
