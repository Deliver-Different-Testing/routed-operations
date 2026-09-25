using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class PickupJobResponse : BaseResponse
    {
        public PickupJobResponse(Guid messageId) : base(messageId)
        {
            JobId = new List<int>();
        }
        public List<int> JobId { get; set; }
    }

    public class PickupJobRateResponse : BaseResponse
    {
        public PickupJobRateResponse(Guid messageId) : base(messageId)
        {
        }
        public decimal? Amount { get; set; }
    }
}
