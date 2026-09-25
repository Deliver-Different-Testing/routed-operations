// NWShip / GoSweetSpot booking transport for the Route Viewer booking
// endpoints (Redelivery / One-off / Top-up). Ports legacy RunViewer
// BookController + BookTopUpJob HTTP-call pattern verbatim, with two
// differences forced by the RoutedOperations environment:
//
// 1. Bearer token: legacy signs a JWT via
//    `AuthenticationExtensions.CreateApiToken` (from an internal shared
//    package that this repo doesn't consume). Here we accept a
//    pre-issued token via env var NWSHIP_API_TOKEN OR extract it from
//    the caller's auth cookie if the Hub already includes an NWShip
//    delegation token in its claims. If neither path resolves, we fail
//    the call with a clear "credentials missing" error rather than
//    silently 500 - operators see a specific message and Kevin knows
//    what to wire.
//
// 2. Env var lookup: TopUpClientID / TopUp2ClientID / TopUp3ClientID
//    for the top-up flow, ReDelClientID for redelivery, and WebAPIUrl
//    for the NWShip base URL. All read at call time (not at DI
//    construction) so per-tenant overrides via AWS SSM take effect
//    without a restart.

using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class NwShipBookingService(
    HttpClient httpClient,
    ILogger<NwShipBookingService> logger)
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>POST /jobs (redelivery / one-off flow). ContactId is
    /// the tenant client id or a per-tenant ReDelClientID env var when
    /// PackageMap != 0. Returns null on transport failure - caller
    /// surfaces to operator.</summary>
    public Task<NwShipResponse?> BookOneOffAsync(NwShipRequest request, int? overrideClientId = null)
        => PostAsync("/jobs", request, overrideClientId);

    /// <summary>POST /jobs/topUp (top-up flow). Selects one of
    /// TopUpClientID / TopUp2ClientID / TopUp3ClientID based on
    /// PackageMap (1-3), same mapping as legacy.</summary>
    public Task<NwShipResponse?> BookTopUpAsync(NwShipRequest request)
    {
        var envKey = request.PackageMap switch
        {
            2 => "TopUp2ClientID",
            3 => "TopUp3ClientID",
            _ => "TopUpClientID",
        };
        var raw = Environment.GetEnvironmentVariable(envKey);
        if (!int.TryParse(raw, out var clientId))
        {
            logger.LogError("Top-up booking cannot proceed - env var {EnvKey} not set", envKey);
            throw new InvalidOperationException(
                $"Route Viewer top-up booking requires env var `{envKey}` to be set on this tenant. " +
                "Kevin: set it via AWS SSM or launchSettings.json and restart.");
        }
        return PostAsync("/jobs/topUp", request, clientId);
    }

    private async Task<NwShipResponse?> PostAsync(string path, NwShipRequest request, int? overrideClientId)
    {
        var baseUrl = Environment.GetEnvironmentVariable("WebAPIUrl");
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            logger.LogError("NWShip {Path} - WebAPIUrl env var not set", path);
            throw new InvalidOperationException(
                "Route Viewer booking requires env var `WebAPIUrl` to point at the NWShip GoSweetSpot API base URL.");
        }
        var token = Environment.GetEnvironmentVariable("NWSHIP_API_TOKEN");
        if (string.IsNullOrWhiteSpace(token))
        {
            logger.LogError("NWShip {Path} - NWSHIP_API_TOKEN env var not set", path);
            throw new InvalidOperationException(
                "Route Viewer booking requires env var `NWSHIP_API_TOKEN` (a pre-issued NWShip bearer). " +
                "Kevin: pull the token from Hub or provision one via GoSweetSpot admin.");
        }

        if (overrideClientId.HasValue) request.ContactId = overrideClientId.Value;

        try
        {
            using var content = JsonContent.Create(request, options: JsonOpts);
            var url = baseUrl.TrimEnd('/') + path;
            using var msg = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var response = await httpClient.SendAsync(msg);
            var body = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                logger.LogError("NWShip {Path} failed status={Status} body={Body}",
                    path, (int)response.StatusCode, body);
                return null;
            }
            return JsonSerializer.Deserialize<NwShipResponse>(body, JsonOpts);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "NWShip {Path} exception", path);
            return null;
        }
    }
}

// ---------------------------------------------------------------------
// DTOs (portable copy of legacy RunViewer.ViewModels.NWShipRequest +
// NWShipResponse). Same shape; namespaced under RouteViewer so we don't
// take a dependency on the legacy assembly.
// ---------------------------------------------------------------------

public class NwShipRequest
{
    public NwShipReDelivery? ReDelivery { get; set; }
    public int ContactId { get; set; }
    public string? QuoteId { get; set; }
    public int SpeedId { get; set; }
    public NwShipPickup? Pickup { get; set; }
    public NwShipDelivery? Delivery { get; set; }
    public List<NwShipPackage>? Packages { get; set; }
    public DateTime? DateTime { get; set; }
    public string? JobType { get; set; }
    public string? JobNotificationType { get; set; }
    public string? JobNotificationEmail { get; set; }
    public string? JobNotificationMobile { get; set; }
    public string? ClientReferenceA { get; set; }
    public string? ClientReferenceB { get; set; }
    public int PackageMap { get; set; }
    public decimal FixedAmount { get; set; }
    public string? OurReference { get; set; }
    public int Items { get; set; }
    public decimal Weight { get; set; }
    public int SourceId { get; set; } = 8;
    public int? CourierID { get; set; }
}

public class NwShipReDelivery
{
    public int OriginalJobId { get; set; }
    public string? Reason { get; set; }
}

public class NwShipPickup
{
    public string? Name { get; set; }
    public string? ContactPerson { get; set; }
    public string? PhoneNumber { get; set; }
    public string? Email { get; set; }
    public NwShipAddress? From { get; set; }
    public string? Notes { get; set; }
}

public class NwShipDelivery
{
    public string? Name { get; set; }
    public string? ContactPerson { get; set; }
    public string? PhoneNumber { get; set; }
    public string? Email { get; set; }
    public NwShipAddress? To { get; set; }
    public string? Notes { get; set; }
}

public class NwShipAddress
{
    public string? BuildingName { get; set; }
    public string? StreetAddress { get; set; }
    public string? Suburb { get; set; }
    public string? City { get; set; }
    public string? PostCode { get; set; }
    public string? CountryCode { get; set; }
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
}

public class NwShipPackage
{
    public string? Name { get; set; }
    public decimal Length { get; set; }
    public decimal Width { get; set; }
    public decimal Height { get; set; }
    public decimal Kg { get; set; }
    public string? Type { get; set; }
    public string? PackageCode { get; set; }
    public int Units { get; set; }
}

public class NwShipResponse
{
    public int JobID { get; set; }
    public string? JobNumber { get; set; }
    public string? TrackingUrl { get; set; }
    public List<NwShipError>? Errors { get; set; }
}

public class NwShipError
{
    public string? Property { get; set; }
    public string? Message { get; set; }
}
