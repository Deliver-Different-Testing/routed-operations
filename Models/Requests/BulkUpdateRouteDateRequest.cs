namespace RunBuilder.Models.Requests
{
    public class BulkUpdateRouteDateRequest
    {
        public List<int> JobIds { get; set; } = new List<int>();
        public DateTime NewDate { get; set; }
        public string RunName { get; set; } = string.Empty;
    }
}
