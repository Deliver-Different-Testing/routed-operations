namespace RunBuilder.Models
{
        public class SavvyLocation
        {
            public string Name { get; set; }
            public double Latitude { get; set; }
            public double Longitude { get; set; }
            public int VisitDurationInMinutes { get; set; }
        }

        public class OptimizeParameters
        {
            public string AppId { get; set; }
            public string OptimizeType { get; set; }
            public string RouteType { get; set; }
            public string Avoid { get; set; }
            public string Departure { get; set; }
        }

        public class RouteSavvyRequest
        {
            public List<SavvyLocation> Locations { get; set; }
            public OptimizeParameters OptimizeParameters { get; set; }
        }
}