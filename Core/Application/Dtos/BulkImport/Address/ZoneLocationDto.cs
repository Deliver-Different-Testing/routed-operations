namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class ZoneLocationDto
    {
        public int ZoneZipId { get; set; } // Add this property
        public int? LocationId { get; set; }
        public string FromCompany { get; set; }
        public string FromAddress { get; set; }
        public string AddressLine5 { get; set; } // City
        public string AddressLine6 { get; set; } // State
        public string AddressLine7 { get; set; } // Zip Code
        public decimal? PickupLatitude { get; set; }
        public decimal? PickupLongitude { get; set; }
        public string FromLatLng => PickupLatitude.HasValue && PickupLongitude.HasValue
            ? $"{PickupLatitude},{PickupLongitude}"
            : null;
    }

    public class ZoneZipWithLocationDto : ZipCodeDto
    {
        public ZoneLocationDto Location { get; set; }
    }
}
