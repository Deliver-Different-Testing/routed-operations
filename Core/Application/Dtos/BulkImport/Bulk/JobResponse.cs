using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class JobResponse : BaseResponse
    {
        public JobResponse(Guid messageId) : base(messageId) { }
        public JobDto Job { get; set; }
    }
}
