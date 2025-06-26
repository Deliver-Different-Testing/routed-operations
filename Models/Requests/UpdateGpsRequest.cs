namespace RunBuilder.Models.Requests
{
    public class UpdateGpsRequest
    {
        public int JobId { get; set; }
        public string Address { get; set; }
        public string Lat { get; set; }
        public string Lng { get; set; }
        public string PostCode { get; set; }
    }
}
