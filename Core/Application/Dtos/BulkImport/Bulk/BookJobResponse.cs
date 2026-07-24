using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class BookJobResponse : BaseResponse
    {
        public BookJobResponse(Guid messageId) : base(messageId) { }
        public int JobID { get; set; }
        public string JobNumber { get; set; }
        public string TrackingUrl { get; set; }
        public List<ErrorDto> ErrorsList { get; set; }
    }
}
