using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class BulkJobSearchResponse : BaseResponse
    {
        public BulkJobSearchResponse(Guid messageId) : base(messageId) { }

        public List<BulkJobFoundDto> FoundJobs { get; set; }
        public List<string> NotFoundJobNumbers { get; set; }
    }

    public class BulkJobFoundDto
    {
        public int Id { get; set; }
        public string JobNumber { get; set; }
        public DateTime BookDate { get; set; }
        public string Speed { get; set; }
        public string ClientCode { get; set; }
        public decimal? Amount { get; set; }
        public string FromAddress { get; set; }
        public string FromSuburb { get; set; }
        public string ToAddress { get; set; }
        public string ToSuburb { get; set; }
        public string CourierCode { get; set; }
        public string Status { get; set; }
        public bool Done { get; set; }
        public bool Void { get; set; }
        public string Type { get; set; } // "routed" or "ondemand"
        public bool CanComplete { get; set; }
    }
}
