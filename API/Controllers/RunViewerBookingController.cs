// Booking endpoints for the Route Viewer dialogs: Redelivery (one-off
// return leg) and Top Up (courier-driven top-up). Wraps the NWShip
// GoSweetSpot HTTP API via NwShipBookingService.
//
// Env vars required for the transport:
//   WebAPIUrl          NWShip base URL
//   NWSHIP_API_TOKEN   Pre-issued bearer (Hub or GoSweetSpot admin)
//   TopUpClientID      Tenant client id for top-up flow (PackageMap=1)
//   TopUp2ClientID     Alt top-up client (PackageMap=2)
//   TopUp3ClientID     Alt top-up client (PackageMap=3)
//   ReDelClientID      Tenant client id for redelivery flow
//
// When an env var is missing, the service throws
// InvalidOperationException with a specific error message; we surface
// that as a 501 with the same message so operators see exactly what
// to configure.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.API.Controllers;

[ApiController]
[Route("api/runviewer/booking")]
[Authorize(Policy = "RouteViewer.Read")]
public class RunViewerBookingController(
    NwShipBookingService bookingService) : BaseController
{
    /// <summary>POST /api/runviewer/booking/one-off - book a
    /// redelivery / return-to-base one-off job.</summary>
    [HttpPost("one-off")]
    public async Task<IActionResult> BookOneOff([FromBody] NwShipRequest payload)
    {
        try
        {
            var reDelClientRaw = Environment.GetEnvironmentVariable("ReDelClientID");
            int? overrideClientId = int.TryParse(reDelClientRaw, out var r) ? r : null;
            var result = await bookingService.BookOneOffAsync(payload, overrideClientId);
            if (result == null)
                return StatusCode(502, new { message = "NWShip returned no response - check server logs." });
            if (result.Errors is { Count: > 0 })
                return BadRequest(new { message = "NWShip validation errors.", errors = result.Errors });
            return Ok(new { response = result });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(501, new { message = ex.Message });
        }
    }

    /// <summary>POST /api/runviewer/booking/top-up - courier-driven
    /// top-up booking.</summary>
    [HttpPost("top-up")]
    public async Task<IActionResult> BookTopUp([FromBody] NwShipRequest payload)
    {
        try
        {
            var result = await bookingService.BookTopUpAsync(payload);
            if (result == null)
                return StatusCode(502, new { message = "NWShip returned no response - check server logs." });
            if (result.Errors is { Count: > 0 })
                return BadRequest(new { message = "NWShip validation errors.", errors = result.Errors });
            return Ok(new { response = result });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(501, new { message = ex.Message });
        }
    }
}
