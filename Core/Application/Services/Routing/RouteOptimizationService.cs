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
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
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
                Departure = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss.fff")
            }
        };

        var response = await httpClient.PostAsJsonAsync(
            "http://optimizer2.routesavvy.com/RSAPI.svc/POSTOptimize", model);

        if (response.IsSuccessStatusCode)
            return await response.Content.ReadFromJsonAsync<RouteSavvyResponse>(_jsonOptions);

        var body = await response.Content.ReadAsStringAsync();
        Log.Error("RouteSavvy POSTOptimize failed: {Status} {Body}", response.StatusCode, body);
        return null;
    }
}
