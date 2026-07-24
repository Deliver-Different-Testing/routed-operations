using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class GeocodeAddressDto : AddressDto
    {
        public string Longitude { get; set; }
        public string Latitude { get; set; }
        public int? GeoType { get; set; }
        public string SuggestedPostCode { get; set; }
        public string SuggestedZipCode { get; set; }
    }
}
