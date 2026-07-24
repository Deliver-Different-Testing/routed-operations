namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    // tblBulkRegion summary for the Step 2 "Origin Location" dropdown.
    // Steve refers to a region as a "site" / "depot" in the brief.
    public class RegionDto
    {
        public int Id { get; set; }              // tblBulkRegion.BulkRegionId
        public string Name { get; set; }
        public string FromCompany { get; set; }
        public string FromAddress { get; set; }
        public string FromCity { get; set; }     // AddressLine5 for US tenants
        public string FromState { get; set; }    // AddressLine6 for US tenants
        public string FromZipCode { get; set; }  // AddressLine7 for US tenants
    }
}
