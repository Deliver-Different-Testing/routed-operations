namespace RoutedOperations.Core.Application.Dtos.BulkImport.Auth
{
    public class GoogleDriveConfig
    {
        public string ClientId { get; set; }
        public string ApiKey { get; set; }
        public string ProjectId { get; set; }
        public string AuthUri { get; set; }
        public string TokenUri { get; set; }
        public string Scope { get; set; }
    }
}
