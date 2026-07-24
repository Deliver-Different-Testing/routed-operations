using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class BulkJobSearchRequest : BaseRequest
    {
        [Required]
        public int ClientId { get; set; }

        [Required]
        public List<BulkJobSearchItem> Jobs { get; set; }

        [Required]
        public string JobType { get; set; } // "routed" or "ondemand"
    }

    public class BulkJobSearchItem
    {
        [Required]
        public string JobNumber { get; set; }

        public DateTime? DateTime { get; set; }

        // Optional narrowing filter. Marked nullable so ASP.NET Core model
        // validation doesn't reject rows that don't supply it - the wizard's
        // BulkCompleteModal only fills this when the operator wrote a third
        // CSV token on the line.
        public string? CourierCode { get; set; }
    }
}
