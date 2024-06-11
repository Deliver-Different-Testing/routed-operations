using System.Runtime.InteropServices.JavaScript;
using Amazon.Runtime.Internal;
using RestSharp;
using Serilog;

namespace RunBuilder.Models.Repository
{
    public class RouteRepository
    {
        public async Task<RouteSavvyResponse> FetchBulkRouteAsync(List<SavvyLocation> waypoints)
        {
            var client = new RestClient("http://optimizer2.routesavvy.com/RSAPI.svc/");
            var request = new RestRequest
            {
                Resource = "POSTOptimize",
                Method = Method.Post,
                RequestFormat = DataFormat.Json
            };

            var model = new RouteSavvyRequest
            {
                Locations = waypoints,
                OptimizeParameters = new OptimizeParameters
                {
                    AppId = Environment.GetEnvironmentVariable("RouteSavyID") ?? "",
                    OptimizeType = "distance",
                    RouteType = "basic", //  basic:500 stops ,realroadcar: 300 stops, realroadcarpredictive, 
                    Avoid = "none",
                    Departure = DateTime.Now.ToString("yyyy-MM-ddThh:mm:ss:fff")
                }
            };

            request.AddJsonBody(model);
            var restResponse = await client.ExecuteAsync<RouteSavvyResponse>(request);
            return restResponse.Data;
        }

        public async Task<HereMapSequenceResponse> GetHereMapSequenceAsync(HereMapSequenceRequest data)
        {
            var client = new RestClient ( "https://wse.api.here.com/2") ;
            var request = new RestRequest
            {
                Resource = "findsequence.json?app_id=" + Environment.GetEnvironmentVariable("HeremapAppId") + "&app_code=" + Environment.GetEnvironmentVariable("HeremapAppCode") + data.requestData,
                Method = Method.Get,
                RequestFormat = DataFormat.Json
            };

            var restResponse = await client.ExecuteAsync<HereMapSequenceResponse>(request);
            Log.Debug($"Start {nameof(GetHereMapSequenceAsync)}: ResponseCode: {restResponse.StatusCode}  Err: {restResponse.ErrorMessage}  Content:{restResponse.Content} Data: {restResponse.Data}");
            if (!restResponse.IsSuccessful)
            {
                Log.Error($"{nameof(GetHereMapSequenceAsync)} Error: {restResponse.StatusCode} {restResponse.ErrorMessage} {restResponse.Content}", restResponse.ErrorException );
            }
            return restResponse.Data;
        }

    }
}