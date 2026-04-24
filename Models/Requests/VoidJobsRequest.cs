namespace RunBuilder.Models.Requests
{
    public class VoidJobsRequest
    {
        public List<int> JobIds { get; set; } = new List<int>();
        public bool IsVoid { get; set; }
        public DateTime RunDate { get; set; }
    }
}
