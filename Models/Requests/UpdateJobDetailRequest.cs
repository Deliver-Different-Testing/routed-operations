namespace RunBuilder.Models.Requests
{
    public class UpdateJobDetailRequest
    {
        public int JobId { get; set; }
        public string Field { get; set; }
        public string Value { get; set; }
    }
}