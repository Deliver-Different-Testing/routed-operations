using RestSharp;

namespace RunBuilder.Models.Repository
{
    public class RouteRepository
    {
        public async Task<RouteSavvyResponse> FetchBulkRouteAsync(List<SavvyLocation> waypoints)
        {
            //foreach (var wp in waypoints)
            //{
            //    Common.Log(wp.Name + " " + wp.Latitude + " " + wp.Longitude);
            //}
            var client = new RestClient ( new Uri("http://routesavvyapijson.cloudapp.net/RSAPI.svc") );
            var request = new RestRequest
            {
                Resource = "PostOptimize",
                Method = Method.Post,
                RequestFormat = DataFormat.Json
            };

            var model = new RouteSavvyRequest
            {
                Locations = waypoints,
                OptimizeParameters = new OptimizeParameters
                {
                    AppId = Environment.GetEnvironmentVariable("RouteSavyID")??"",
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

            var restResponse = await client.ExecuteAsync<RouteSavvyResponse>(request);
            return restResponse.Data;
        }
    }
}