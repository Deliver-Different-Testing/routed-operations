using DeliverDifferent.AccessControl.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoutedOperations.Core.Application.Dtos.Pricing;
using RoutedOperations.Core.Application.Services.Pricing;

namespace RoutedOperations.API.Controllers;

/// <summary>
/// The Pricing tab in Schedules NEW (spec 3.3): zone rates, dimension bands,
/// surcharges and offered speeds. Reads open to any RouteBuilder.Read user;
/// every write gated on RouteBuilder.Admin, because these are prices.
/// </summary>
[ApiController]
[Route("api/pricing")]
[Authorize(Policy = "RouteBuilder.Read")]
[RequireFeature("ro-schedules")]
public class PricingController(PricingService svc) : BaseController
{
    [HttpGet("bootstrap")]
    public async Task<IActionResult> GetBootstrap() =>
        await Wrap(() => svc.GetBootstrapAsync());

    // ─── ZONE RATES ────────────────────────────────────────────────────────

    [HttpGet("zone-rates")]
    public async Task<IActionResult> GetZoneRates(
        [FromQuery] int postcodeGroupId, [FromQuery] int? clientId = null) =>
        await Wrap(() => svc.GetZoneRatesAsync(postcodeGroupId, clientId));

    [HttpPut("zone-rates")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpsertZoneRate([FromBody] ZoneRateUpsertRequest req) =>
        await Wrap(() => svc.UpsertZoneRateAsync(req));

    /// <summary>Drop every override this client has in one group.</summary>
    [HttpPost("zone-rates/reset")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> ResetOverrides(
        [FromQuery] int postcodeGroupId, [FromQuery] int clientId) =>
        await Wrap(() => svc.ResetClientOverridesAsync(postcodeGroupId, clientId));

    // ─── DIMENSIONS ────────────────────────────────────────────────────────

    [HttpGet("package-rates")]
    public async Task<IActionResult> GetPackageRates([FromQuery] int? clientId = null) =>
        await Wrap(() => svc.GetPackageRatesAsync(clientId));

    [HttpPut("package-rates")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpsertPackageRate([FromBody] PackageRateUpsertRequest req) =>
        await Wrap(() => svc.UpsertPackageRateAsync(req));

    [HttpDelete("package-rates/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeletePackageRate(int id) =>
        await WrapVoid(() => svc.DeletePackageRateAsync(id));

    // ─── SURCHARGES ────────────────────────────────────────────────────────

    [HttpGet("surcharges")]
    public async Task<IActionResult> GetSurcharges([FromQuery] int? clientId = null) =>
        await Wrap(() => svc.GetSurchargesAsync(clientId));

    [HttpPut("surcharges")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> UpsertSurcharge([FromBody] SurchargeUpsertRequest req) =>
        await Wrap(() => svc.UpsertSurchargeAsync(req));

    [HttpDelete("surcharges/{id:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> DeleteSurcharge(int id) =>
        await WrapVoid(() => svc.DeleteSurchargeAsync(id));

    // ─── SPEEDS ────────────────────────────────────────────────────────────

    [HttpGet("speeds")]
    public async Task<IActionResult> GetSpeeds([FromQuery] int? clientId = null) =>
        await Wrap(() => svc.GetOfferedSpeedsAsync(clientId));

    [HttpPost("speeds/{speedId:int}")]
    [Authorize(Policy = "RouteBuilder.Admin")]
    public async Task<IActionResult> SetSpeedOffered(
        int speedId, [FromQuery] bool offered, [FromQuery] int? clientId = null) =>
        await Wrap(() => svc.SetSpeedOfferedAsync(speedId, offered, clientId));

    // ─── HELPERS ───────────────────────────────────────────────────────────

    private async Task<IActionResult> Wrap<T>(Func<Task<T>> op)
    {
        if (!ModelState.IsValid) return HandleInvalidModelState(Guid.NewGuid());
        try
        {
            var result = await op();
            return Ok(new { response = result });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    private async Task<IActionResult> WrapVoid(Func<Task> op)
    {
        try
        {
            await op();
            return Ok(new { response = "Deleted" });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
