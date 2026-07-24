using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public partial class GoogleGeocodingResponse
    {
        public string Status { get; set; }
        public IEnumerable<GoogleGeocodingResult> Results { get; set; }
    }

    public partial class GoogleGeocodingResult
    {
        [JsonProperty("address_components")]
        public IEnumerable<GoogleGeocodingAddressComponent> AddressComponents { get; set; }
        public GoogleGeocodingGeometry Geometry { get; set; }
    }

    public partial class GoogleGeocodingAddressComponent
    {
        [JsonProperty("long_name")]
        public string LongName { get; set; }
        [JsonProperty("short_name")]
        public string ShortName { get; set; }
        public string[] Types { get; set; }
    }

    public partial class GoogleGeocodingGeometry
    {
        public GoogleGeocodingLocation Location { get; set; }

        [JsonProperty("location_type")]
        public string LocationType { get; set; }
    }

    public partial class GoogleGeocodingLocation
    {
        public double Lat { get; set; }
        public double Lng { get; set; }
    }

}
