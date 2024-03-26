namespace RunBuilder.Models
{

    public class GeocodedWaypoint
{
    public string geocoder_status { get; set; }
    public string place_id { get; set; }
    public List<string> types { get; set; }
}

public class Bounds
{
    public double south { get; set; }
    public double west { get; set; }
    public double north { get; set; }
    public double east { get; set; }
}

public class Distance
{
    public string text { get; set; }
    public int value { get; set; }
}

public class Duration
{
    public string text { get; set; }
    public int value { get; set; }
}

public class EndLocation
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class StartLocation
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class Distance2
{
    public string text { get; set; }
    public int value { get; set; }
}

public class Duration2
{
    public string text { get; set; }
    public int value { get; set; }
}

public class EndLocation2
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class Polyline
{
    public string points { get; set; }
}

public class StartLocation2
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class Path
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class LatLng
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class StartPoint
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class EndPoint
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class Step
{
    public Distance2 distance { get; set; }
    public Duration2 duration { get; set; }
    public EndLocation2 end_location { get; set; }
    public Polyline polyline { get; set; }
    public StartLocation2 start_location { get; set; }
    public string travel_mode { get; set; }
    public string encoded_lat_lngs { get; set; }
    public List<Path> path { get; set; }
    public List<LatLng> lat_lngs { get; set; }
    public string instructions { get; set; }
    public string maneuver { get; set; }
    public StartPoint start_point { get; set; }
    public EndPoint end_point { get; set; }
}

public class Leg
{
    public Distance distance { get; set; }
    public Duration duration { get; set; }
    public string end_address { get; set; }
    public EndLocation end_location { get; set; }
    public string start_address { get; set; }
    public StartLocation start_location { get; set; }
    public List<Step> steps { get; set; }
    public List<object> traffic_speed_entry { get; set; }
    public List<object> via_waypoint { get; set; }
    public List<object> via_waypoints { get; set; }
}

public class OverviewPath
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class Route
{
    public Bounds bounds { get; set; }
    public string copyrights { get; set; }
    public List<Leg> legs { get; set; }
    public string overview_polyline { get; set; }
    public string summary { get; set; }
    public List<object> warnings { get; set; }
    public List<int> waypoint_order { get; set; }
    public List<OverviewPath> overview_path { get; set; }
}

public class Location
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class Origin
{
    public Location location { get; set; }
}

public class Location2
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class Destination
{
    public Location2 location { get; set; }
}

public class Location4
{
    public double lat { get; set; }
    public double lng { get; set; }
}

public class Location3
{
    public Location4 location { get; set; }
}

public class Waypoint
{
    public Location3 location { get; set; }
    public bool stopover { get; set; }
}

public class Request
{
    public Origin origin { get; set; }
    public Destination destination { get; set; }
    public List<Waypoint> waypoints { get; set; }
    public bool optimizeWaypoints { get; set; }
    public string travelMode { get; set; }
}

public class GoogleDirectionsResponse
{
    public List<GeocodedWaypoint> geocoded_waypoints { get; set; }
    public List<Route> routes { get; set; }
    public string status { get; set; }
    public Request request { get; set; }
}

    //public class GoogleDirectionsResponse
    //{
    //    public string Status { get; set; }
    //    public List<GeocodedWaypoint> geocoded_waypoints { get; set; }
    //    public List<GoogleRoute> routes {get; set; }
    //}

    //public class GoogleBound
    //{
    //    public LatLng southwest { get; set; }
    //    public LatLng northeast { get; set; }
    //}

    //public class GeocodedWaypoint
    //{
    //    public string geocoder_status {get;set;}
    //    public string place_id {get;set;}
    //    public string[] types {get;set;}
    //}

    //public class LatLng
    //{
    //    public double lat { get; set; }
    //    public double lng { get; set; }
    //}

    //public class PolyLine
    //{
    //    public string points { get; set; }
    //}

    //public class GoogleRoute
    //{
    //    public string summary { get; set; }
    //    public List<Leg> legs { get; set; }
    //    public int[] waypoint_order { get; set; }
    //    public PolyLine overview_polyline { get; set; }
    //    public GoogleBound bounds { get; set; }
    //    public string copyrights { get; set; }
    //    public string[] warnings { get; set; }
    //}

    //public class Step
    //{
    //    public string travel_mode { get; set; }
    //    public LatLng start_location { get; set; }

    //    public LatLng end_location { get; set; }
    //    public PolyLine polyline { get; set; }
    //    public DicValue duration { get; set; }
    //    public string html_instructions { get;set; }
    //    public DicValue distance { get; set; }
    //}

    //public class Leg
    //{
    //    public List<Step> steps { get; set; }
    //    public DicValue duration { get; set; }
    //    public DicValue distance { get; set; }
    //    public LatLng start_location { get; set; }
    //    public LatLng end_location { get; set; }
    //    public string start_address { get; set; }
    //    public string end_address { get; set; }
    //}

    //public class DicValue
    //{
    //    public string value { get; set; }  
    //    public string text { get; set; }
    //}

}