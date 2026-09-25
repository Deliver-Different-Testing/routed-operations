using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class BulkJobCompleteRequest : BaseRequest
    {
        [Required]
        public int ClientId { get; set; }

        [Required]
        public List<BulkJobCompleteItem> Jobs { get; set; }

        [Required]
        public string JobType { get; set; } // "routed" or "ondemand"
    }

    public class BulkJobCompleteItem
    {
        [Required]
        public int JobId { get; set; }

        // Optional metadata for the completion log; not required by the SP.
        public string? JobNumber { get; set; }

        public string? CourierCode { get; set; }
    }
}
