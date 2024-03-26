namespace RunBuilder.Models.Repository
{
    public class GoogleDirectionRepository
    {
        public List<LatLng> GetOrderedWaypoints(RouteSavvyResponse savvyResponse)
        {
            var locations = new List<LatLng>();
            if (savvyResponse.Message == "Success")
            {
                foreach (var item in savvyResponse.OptimizedStops)
                {

                    locations.Add(new LatLng
                    {
                        lat = item.RouteLocation.Latitude,
                        lng = item.RouteLocation.Longitude
                    });
                }
            }
            return locations;
        }

        public List<object> GetOrderedWaypointsWithName(RouteSavvyResponse savvyResponse)
        {
            var locations = new List<object>();
            if (savvyResponse.Message == "Success")
            {
                foreach (var item in savvyResponse.OptimizedStops)
                {
                    locations.Add(new
                    {
                        name = item.Name,
                        lat = item.RouteLocation.Latitude,
                        lng = item.RouteLocation.Longitude
                    });

                }
            }
            return locations;
        }

        public int SecToMinConvert(int secTime)
        {
            return secTime / 60;
        }

        public string SecToMinTextConvert(int secTime)
        {
            var minTime = secTime / 60;
            var minText = minTime > 1 ? " mins" : " min";

            return minTime.ToString() + minText;
        }
    }
}