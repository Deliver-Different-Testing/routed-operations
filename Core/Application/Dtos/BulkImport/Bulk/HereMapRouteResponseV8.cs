using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class HereMapRouteResponseV8
    {
        public List<Route> routes { get; set; }
    }

    // Root myDeserializedClass = JsonConvert.DeserializeObject<Root>(myJsonResponse);
    public class Location
    {
        public double lat { get; set; }
        public double lng { get; set; }
    }

    public class Place
    {
        public Location location { get; set; }
        public string type { get; set; }
    }

    public class Arrival
    {
        public Place place { get; set; }
        public DateTime time { get; set; }
    }

    public class Departure
    {
        public Place place { get; set; }
        public DateTime time { get; set; }
    }

    public class Summary
    {
        public float duration { get; set; }
        public float length { get; set; }
    }

    public class Transport
    {
        public string mode { get; set; }
    }

    public class Section
    {
        public Arrival arrival { get; set; }
        public Departure departure { get; set; }
        public string id { get; set; }
        public Summary summary { get; set; }
        public Transport transport { get; set; }
        public string type { get; set; }
    }

    public class Route
    {
        public string id { get; set; }
        public List<Section> sections { get; set; }
    }
}
