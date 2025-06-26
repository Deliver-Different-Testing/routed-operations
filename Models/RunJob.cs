using UCLRun;

namespace RunBuilder.Models
{
    public class RunJob
    {
        public int? ID { get; set; }
        public string Name { get; set; }
        public int? Mins { get; set; }
        public float? Kms { get; set; }
        public int? Status { get; set; }
        public decimal? Revenue { get; set; }
        public decimal? Payout { get; set; }
        public Courier? Courier { get; set; }
        public string? CourierPercent { get; set; }
        public GoogleDirectionsResponse? GoogleRouteResponse { get; set; }
        public IEnumerable<Job> Jobs { get; set; }
    }

    public class Job : BulkJob
    {
        public int? BuilderIndex { get; set; }
    }

    public class Courier
    {
        public int? courierID { get; set; }
        public string? courier { get; set; }
    }
}