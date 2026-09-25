using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System.Collections.Generic;
using System;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{

    public class RatesResponse : BaseResponse
    {
        public RatesResponse(Guid messageId) : base(messageId) { }
        public List<RateDto> Rates { get; set; }
        public Dictionary<string, string> Errors { get; set; } = new Dictionary<string, string>();
    }
}
