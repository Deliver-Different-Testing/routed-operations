using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Web;
using RestSharp;
using UCLRun.Models.Interface;

namespace UCLRun.Models.Repository
{
    public class RouteRepository: IRouteRepository
    {
        public async Task<RouteSavvyResponse> FetchBulkRouteAsync(List<SavvyLocation> waypoints)
        {
            //foreach (var wp in waypoints)
            //{
            //    Common.Log(wp.Name + " " + wp.Latitude + " " + wp.Longitude);
            //}
            var client = new RestClient { BaseUrl = new Uri("http://routesavvyapijson.cloudapp.net/RSAPI.svc") };
            var request = new RestRequest
            {
                Resource = "PostOptimize",
                Method = Method.POST,
                RequestFormat = DataFormat.Json,
                JsonSerializer = new RestSharpJsonNetSerializer()
            };

            var model = new RouteSavvyRequest
            {
                Locations = waypoints,
                OptimizeParameters = new OptimizeParameters
                {
                    AppId = "5799c73143f44e8f8664eb6b584790a5",
                    OptimizeType = "distance",
                    RouteType = "realroadcar",
                    Avoid = "none",
                    Departure = DateTime.Now.ToString("yyyy-MM-ddThh:mm:ss:fff")
                }
            };

            request.AddJsonBody(model);
            var body = request.Parameters.FirstOrDefault(p => p.Type == ParameterType.RequestBody);
            if (body != null)
            {
                Console.WriteLine("CurrentBody={0}", body.Value);
                //LOGGER.Debug($"CurrentBody={body.Value}");
            }

            var restResponse = await client.ExecuteTaskAsync<RouteSavvyResponse>(request);
            return restResponse.Data;
        }
    }
}