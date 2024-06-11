using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;

namespace RunBuilder.Models
{
    public class HereMapSequenceRequest
    {
        public string requestData { get; set; }
    }

    public class Interconnection
    {
        public string fromWaypoint { get; set; }
        public string toWaypoint { get; set; }
        public double distance { get; set; }
        public double time { get; set; }
        public double rest { get; set; }
        public double waiting { get; set; }
    }

    public class Result
    {
        public List<HereMapWaypoint> waypoints { get; set; }
        public string distance { get; set; }
        public string time { get; set; }
        public List<Interconnection> interconnections { get; set; }
        public string description { get; set; }
        public TimeBreakdown timeBreakdown { get; set; }
    }

    public class HereMapSequenceResponse
    {
        public List<Result> results { get; set; }
        public List<object> errors { get; set; }
        public string processingTimeDesc { get; set; }
        public string responseCode { get; set; }
        public object warnings { get; set; }
        public string requestId { get; set; }
    }

    public class TimeBreakdown
    {
        public int driving { get; set; }
        public int service { get; set; }
        public int rest { get; set; }
        public int waiting { get; set; }
    }

    public class HereMapWaypoint
    {
        public string id { get; set; }
        public double lat { get; set; }
        public double lng { get; set; }
        public int sequence { get; set; }
        public object estimatedArrival { get; set; }
        public object estimatedDeparture { get; set; }
        public List<object> fulfilledConstraints { get; set; }
    }

}