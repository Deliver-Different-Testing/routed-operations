using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.BulkImport.Address;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Application.Services.Routing;
using Serilog;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// Phase 1 Task 6 port of BulkImportHyper's AddressController. Backs the
/// address / geocoding / region / postcode-depot lookups the Bulk Import
/// wizard needs during Steps 2 (Origin), 3 (Rows) and 5 (Grouping).
///
/// NZ / US tenant selection happens inside AddressService via the
/// CountryCode claim, so identical endpoints do the right thing for
/// either tenant type - the ones that don't apply return an empty list.
/// </summary>
[ApiController]
[Route("api/address")]
[Authorize(Policy = "RouteBuilder.Admin")]
public class AddressController(
    AddressService addressService,
    HereGeocodeService hereGeocodeService,
    ILogger<AddressController> logger) : BaseController
{
    private int GetCurrentContactId()
    {
        var raw = User?.FindFirstValue("ContactID");
        return int.TryParse(raw, out var id) ? id : 0;
    }

    private void LogRequestStart(Guid messageId)
    {
        Log.Information("({Method} {Path})({ContactId})({MessageId})",
            Request.Method, Request.Path, GetCurrentContactId(), messageId);
    }

    private IActionResult HandleBulkResponse(BaseResponse response)
    {
        Log.Information("Response ({MessageId})({ContactId}): Success={Success}",
            response.MessageId, GetCurrentContactId(), response.Success);
        return response.Success ? Ok(response) : BadRequest(response);
    }

    private IActionResult HandleBulkInvalidModelState(Guid messageId)
    {
        var response = new BaseResponse(messageId);
        var messages = ModelState
            .SelectMany(kv => kv.Value!.Errors.Select(e => new MessageDto { Message = e.ErrorMessage }));
        response.Messages.AddRange(messages);
        Log.Warning("Response ({MessageId})({ContactId}): {Response}",
            response.MessageId, GetCurrentContactId(), JsonConvert.SerializeObject(response));
        return BadRequest(response);
    }

    // GET /api/address/suburbs - NZ suburb reference list. Returns []
    // for US tenants (checked inside the service).
    [HttpGet("suburbs")]
    public async Task<IActionResult> GetSuburbs()
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);
            return HandleBulkResponse(await addressService.GetSuburbs(messageId));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Address.GetSuburbs failed");
            throw;
        }
    }

    // GET /api/address/zipcodes - US ZIP reference list (from ZoneZip).
    // Not filtered by tenant server-side (the source deliberately kept it
    // permissive so US-oriented UI can still probe from an NZ session
    // during dev/test), so NZ callers may see a populated response.
    [HttpGet("zipcodes")]
    public async Task<IActionResult> GetZipCodes()
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);
            return HandleBulkResponse(await addressService.GetZipCodes(messageId));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Address.GetZipCodes failed");
            throw;
        }
    }

    // POST /api/address/geocode - resolves N addresses to lat/lng using
    // the tenant's historical tblBulkJob rows first (free + deterministic)
    // and falling back to HERE Maps for anything still unresolved.
    [HttpPost("geocode")]
    public async Task<IActionResult> Geocode([FromBody] GeocodeRequest request)
    {
        try
        {
            LogRequestStart(request.MessageId);
            if (!ModelState.IsValid)
                return HandleBulkInvalidModelState(request.MessageId);
            return HandleBulkResponse(await addressService.Geocode(request));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Address.Geocode failed");
            throw;
        }
    }

    // GET /api/address/depots/postcodes - NZ postcode-to-depot mapping.
    // Returns [] for US tenants (checked inside the service).
    [HttpGet("depots/postcodes")]
    public async Task<IActionResult> GetPostcodesByDepot()
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);
            return HandleBulkResponse(await addressService.GetPostcodesByDepotAsync(messageId));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Address.GetPostcodesByDepot failed");
            throw;
        }
    }

    // GET /api/address/zip-polygons - US ZIP coverage list. Used at Step 5
    // to bucket destinations into the "Valid ZIP - Rate By Distance"
    // group when they're covered but not yet routed to a specific location.
    [HttpGet("zip-polygons")]
    public async Task<IActionResult> GetZipPolygons()
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);
            return HandleBulkResponse(await addressService.GetZipPolygons(messageId));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Address.GetZipPolygons failed");
            throw;
        }
    }

    // GET /api/address/regions - active tblBulkRegion rows for the Origin
    // Location dropdown at Step 2.
    [HttpGet("regions")]
    public async Task<IActionResult> GetRegions()
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);
            return HandleBulkResponse(await addressService.GetRegions(messageId));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Address.GetRegions failed");
            throw;
        }
    }

    // GET /api/address/locations/zipcodes - US ZIP -> Location groupings
    // from ZoneName / ZoneZip. Powers the Step 5 location grouping UI.
    [HttpGet("locations/zipcodes")]
    public async Task<IActionResult> GetZipCodesByLocation()
    {
        try
        {
            var messageId = Guid.NewGuid();
            LogRequestStart(messageId);
            return HandleBulkResponse(await addressService.GetZipCodesByLocationAsync(messageId));
        }
        catch (Exception e)
        {
            logger.LogError(e, "Address.GetZipCodesByLocation failed");
            throw;
        }
    }

    // GET /api/address/reverse-geocode?lat=&lng=&country= - HERE reverse
    // geocode proxy for the Fix GPS modal (map right-click + marker drag).
    // Overrides the controller-level Admin policy because the caller is the
    // cockpit Build workflow, matching PATCH /api/jobs/{id}/gps.
    [HttpGet("reverse-geocode")]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> ReverseGeocode([FromQuery] double lat, [FromQuery] double lng, [FromQuery] string? country = null)
    {
        try
        {
            var result = await hereGeocodeService.ReverseGeocodeAsync(lat, lng, country);
            if (result == null) return Ok(new { found = false });
            return Ok(new
            {
                found = true,
                lat = result.Lat,
                lng = result.Lng,
                formattedAddress = result.FormattedAddress,
                postCode = result.PostCode,
                suburb = result.Suburb,
                countryCode = result.CountryCode,
            });
        }
        catch (Exception e)
        {
            logger.LogError(e, "Address.ReverseGeocode failed");
            throw;
        }
    }

    // GET /api/address/forward-geocode?address=&country= - HERE forward
    // geocode proxy for the Fix GPS modal Search button. Same shape as
    // reverse-geocode so the front end handles both symmetrically.
    // Kept separate from the POST /geocode batch endpoint used by BulkImport
    // because that path resolves against the tenant's historical tblBulkJob
    // rows first and is optimised for high-fanout batches, whereas this
    // endpoint is a single-address direct HERE call sized for interactive UI.
    [HttpGet("forward-geocode")]
    [Authorize(Policy = "RouteBuilder.Build")]
    public async Task<IActionResult> ForwardGeocode([FromQuery] string address, [FromQuery] string? country = null)
    {
        try
        {
            var result = await hereGeocodeService.GeocodeAsync(address, country);
            if (result == null) return Ok(new { found = false });
            return Ok(new
            {
                found = true,
                lat = result.Lat,
                lng = result.Lng,
                formattedAddress = result.FormattedAddress,
                postCode = result.PostCode,
                suburb = result.Suburb,
                countryCode = result.CountryCode,
            });
        }
        catch (Exception e)
        {
            logger.LogError(e, "Address.ForwardGeocode failed");
            throw;
        }
    }
}
