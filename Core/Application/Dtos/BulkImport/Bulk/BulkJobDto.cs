using System;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class BulkJobDto
    {
        public int Id { get; set; }
        public string JobNumber { get; set; }
        public DateTime BookDate { get; set; }
        public string Speed { get; set; }
        public string ClientCode { get; set; }
        //public string Contact { get; set; }
        public decimal? Amount { get; set; }
        public string FromCompany { get; set; }
        public string FromAddress { get; set; }
        public string FromCity { get; set; }
        public string FromSuburb { get; set; }
        public string FromState { get; set; }
        public string FromZipCode { get; set; }
        //public string FromPostCode { get; set; }
        //public string FromLatitude { get; set; }
        //public string FromLongitude { get; set; }
        //public int? FromGeoType { get; set; }
        public string ToCompany { get; set; }
        public string ToAddress { get; set; }
        public string ToCity { get; set; }
        public string ToSuburb { get; set; }
        public string ToState { get; set; }
        public string ToZipCode { get; set; }
        public string ToPostCode { get; set; }

        //public string ToLatitude { get; set; }
        //public string ToLongitude { get; set; }
        //public int? ToGeoType { get; set; }
        //public string ToContact { get; set; }
        //public string ToContactPhone { get; set; }
        //public short? Quantity { get; set; }
        //public decimal? Weight { get; set; }
        //public string ClientRefA { get; set; }
        //public string ClientRefB { get; set; }
        //public string OurRef { get; set; }
        //public string Notes { get; set; }
        //public string TrackingEmail { get; set; }
        //public string TrackingMobile { get; set; }
        public bool CanDelete { get; set; }
    }

    public class BulkJobListDto {
        public int Id { get; set; }
        public string JobNumber { get; set; }
        public DateTime BookDate { get; set; }
        public string Speed { get; set; }
        public string ClientCode { get; set; }
        public decimal? Amount { get; set; }
        public int? Quantity { get; set; }

        // Original fields
        public string FromAddress { get; set; }
        public string FromSuburb { get; set; }
        public string ToAddress { get; set; }
        public string ToSuburb { get; set; }
        public string ToPostCode { get; set; }

        // New fields for US address format
        public string FromCompany { get; set; }
        public string FromCity { get; set; }
        public string FromState { get; set; }
        public string FromZipCode { get; set; }
        public string ToCompany { get; set; }
        public string ToCity { get; set; }
        public string ToState { get; set; }
        public string ToZipCode { get; set; }

        // Flags and metadata
        public bool CanDelete { get; set; }

        // New fields for job type and status
        public string Type { get; set; }  // "ondemand" or "routed"
    }
}
