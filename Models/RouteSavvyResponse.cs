namespace RunBuilder.Models
{
    public class RouteLocation
    {
        public double Latitude { get; set; }
        public double Longitude { get; set; }
    }

    public class OptimizedStop
    {
        public string Arrival { get; set; }
        public string Departure { get; set; }
        public string Distance { get; set; }
        public string Duration { get; set; }
        public bool IsDuplicate { get; set; }
        public string Name { get; set; }
        public RouteLocation RouteLocation { get; set; }
        public int StopTimeMinutes { get; set; }
    }

    
    public class LegBegin
    {
        public string Name { get; set; }
        public RouteLocation RouteLocation { get; set; }
    }

    
    public class LegEnd
    {
        public string Name { get; set; }
        public RouteLocation RouteLocation { get; set; }
    }

    public class RouteLeg
    {
        public List<string> Directions { get; set; }
        public double DriveDistance { get; set; }
        public int DriveTime { get; set; }
        public LegBegin LegBegin { get; set; }
        public LegEnd LegEnd { get; set; }
    }

    public class SavvyRoute
    {
        public double DriveDistance { get; set; }
        public string DriveDistanceUnit { get; set; }
        public int DriveTime { get; set; }
        public string DriveTimeUnit { get; set; }
        public List<RouteLeg> RouteLegs { get; set; }
        public List<List<double>> RoutePath { get; set; }
    }

    public class RouteSavvyResponse
    {
        public string Message { get; set; }
        public List<OptimizedStop> OptimizedStops { get; set; }
        public SavvyRoute Route { get; set; }
    }
}