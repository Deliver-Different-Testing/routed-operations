using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class BulkJobsResponse : BaseResponse
    {
        public BulkJobsResponse(Guid messageId) : base(messageId)
        {
        }

        public IEnumerable<BulkJobListDto> Jobs { get; set; }
    }
}
