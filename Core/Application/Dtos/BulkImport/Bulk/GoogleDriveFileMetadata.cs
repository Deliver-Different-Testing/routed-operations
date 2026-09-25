using Newtonsoft.Json;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{

    // Add this class for parsing file metadata
    public class GoogleDriveFileMetadata
    {
        [JsonProperty("mimeType")]
        public string MimeType { get; set; }

        [JsonProperty("name")]
        public string Name { get; set; }
    }
}
