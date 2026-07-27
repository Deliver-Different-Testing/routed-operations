using System.Net.Http.Json;
using System.Text.Json;
using RoutedOperations.Core.Application.Dtos.Route;
using RoutedOperations.Infrastructure;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Routing;

/// <summary>
/// Server-side proxy for the RouteSavvy optimizer. Same request shape and
/// response mapping as the legacy `RouteRepository.FetchBulkRouteAsync`.
/// </summary>
public class RouteOptimizationService(HttpClient httpClient, AppSettings appSettings)
{
    // Both directions: RouteSavvy is a WCF SVC that both accepts AND emits
    // PascalCase JSON (`Locations` in, `Message`/`OptimizedStops` out) per
    // WCF DataContract defaults. So we use the same PascalCase (null policy)
    // options for the request body serialisation AND the response body
    // deserialisation. `PropertyNameCaseInsensitive = true` is belt-and-
    // braces so a hypothetical future casing tweak on their side doesn't
    // silently null every field.
    //
    // Legacy RunBuilder RouteRepository had `PropertyNamingPolicy =
    // CamelCase` on its read options; that was a latent bug that only
    // avoided misbehaviour because System.Text.Json used to be more
    // forgiving. On .NET 10 the same options now silently bind every
    // Message/OptimizedStops field to null and return empty routes.
    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = null,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false,
    };

    public async Task<List<LatLngDto>> OptimizeAsync(List<SavvyLocationDto> waypoints)
    {
        var response = await FetchAsync(waypoints);
        if (response?.Message != "Success") return new List<LatLngDto>();
        return response.OptimizedStops
            .Select(s => new LatLngDto { Lat = s.RouteLocation.Latitude, Lng = s.RouteLocation.Longitude })
            .ToList();
    }

    public async Task<List<LatLngDto>> OptimizeWithNamesAsync(List<SavvyLocationDto> waypoints)
    {
        var response = await FetchAsync(waypoints);
        if (response?.Message != "Success") return new List<LatLngDto>();
        return response.OptimizedStops
            .Select(s => new LatLngDto
            {
                Name = s.Name,
                Lat = s.RouteLocation.Latitude,
                Lng = s.RouteLocation.Longitude
            })
            .ToList();
    }

    private async Task<RouteSavvyResponse?> FetchAsync(List<SavvyLocationDto> waypoints)
    {
        if (string.IsNullOrEmpty(appSettings.RouteSavvyAppId))
        {
            Log.Warning("RouteSavvyAppId not configured - optimize endpoint disabled");
            throw new InvalidOperationException("RouteSavvyAppId env var (`RouteSavyID`) is not set.");
        }

        var model = new RouteSavvyRequest
        {
            Locations = waypoints,
            OptimizeParameters = new OptimizeParameters
            {
                AppId = appSettings.RouteSavvyAppId,
                OptimizeType = "distance",
                RouteType = "basic",
                Avoid = "none",
                // RouteSavvy is strict about this format: 12-hour hh (not
                // 24-hour HH) and COLON-separated milliseconds (not dot).
                // Any deviation (e.g. `HH:mm:ss.fff`, ISO-8601 with tz)
                // returns HTTP 400 BadRequest with a null-argument error
                // from Enumerable.Count() inside their POSTOptimize handler.
                // Matches the legacy RunBuilder RouteRepository format exactly.
                Departure = DateTime.Now.ToString("yyyy-MM-ddThh:mm:ss:fff")
            }
        };

        var response = await httpClient.PostAsJsonAsync(
            "http://optimizer2.routesavvy.com/RSAPI.svc/POSTOptimize",
            model,
            _jsonOptions);

        if (response.IsSuccessStatusCode)
        {
            try
            {
                return await response.Content.ReadFromJsonAsync<RouteSavvyResponse>(_jsonOptions);
            }
            catch (Exception ex)
            {
                // Response was 2xx but the body didn't shape-match
                // RouteSavvyResponse. Log the head so a wire-format change
                // upstream is diagnosable without adding a full trace log.
                var raw = await response.Content.ReadAsStringAsync();
                Log.Error(ex, "RouteSavvy response deserialize failed. Body head: {Head}",
                    raw.Length > 500 ? raw.Substring(0, 500) : raw);
                return null;
            }
        }

        var body = await response.Content.ReadAsStringAsync();
        Log.Error("RouteSavvy POSTOptimize failed: {Status} {Body}", response.StatusCode, body);
        return null;
    }
}
