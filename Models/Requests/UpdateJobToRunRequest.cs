namespace RunBuilder.Models.Requests
{
    public class UpdateJobToRunRequest
    {
        public int JobId { get; set; }
        public int? FromRunId { get; set; }
        public int RunId { get; set; }
    }
}