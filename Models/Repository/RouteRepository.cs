using System.Runtime.InteropServices.JavaScript;
using Amazon.Runtime.Internal;
using Serilog;

namespace RunBuilder.Models.Repository
{
   using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

public class RouteRepository(HttpClient httpClient, ILogger<RouteRepository> logger)
{
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public async Task<RouteSavvyResponse> FetchBulkRouteAsync(List<SavvyLocation> waypoints)
    {
        var model = new RouteSavvyRequest
        {
            Locations = waypoints,
            OptimizeParameters = new OptimizeParameters
            {
                AppId = Environment.GetEnvironmentVariable("RouteSavyID") ?? "",
                OptimizeType = "distance",
                RouteType = "basic", // basic:500 stops, realroadcar: 300 stops, realroadcarpredictive
                Avoid = "none",
                Departure = DateTime.Now.ToString("yyyy-MM-ddThh:mm:ss:fff")
            }
        };

        var response = await httpClient.PostAsJsonAsync("http://optimizer2.routesavvy.com/RSAPI.svc/POSTOptimize", model);
        
        if (response.IsSuccessStatusCode)
        {
            return await response.Content.ReadFromJsonAsync<RouteSavvyResponse>(_jsonOptions);
        }

        logger.LogError($"Error in {nameof(FetchBulkRouteAsync)}: {response.StatusCode}, {await response.Content.ReadAsStringAsync()}");
        return null;
    }

    public async Task<HereMapSequenceResponse> GetHereMapSequenceAsync(HereMapSequenceRequest data)
    {
        //var url = $"https://wse.api.here.com/2/findsequence.json?app_id={Environment.GetEnvironmentVariable("HeremapAppId")}&app_code={Environment.GetEnvironmentVariable("HeremapAppCode")}{data.requestData}";
        var url = $"https://wps.hereapi.com/v8/findsequence2?&apiKey={Environment.GetEnvironmentVariable("HeremapApiKey")}{data.requestData}";

            var response = await httpClient.GetAsync(url);
        
        logger.LogDebug($"Start {nameof(GetHereMapSequenceAsync)}: ResponseCode: {response.StatusCode}");
        
        if (!response.IsSuccessStatusCode)
        {
            string content = await response.Content.ReadAsStringAsync();
            logger.LogError($"{nameof(GetHereMapSequenceAsync)} Error: {response.StatusCode} {content}");
            return null;
        }
        
        return await response.Content.ReadFromJsonAsync<HereMapSequenceResponse>(_jsonOptions);
    }
}
}