using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class BulkImportResponse : BaseResponse
    {
        public BulkImportResponse(Guid messageId) : base(messageId)
        {
        }

        public int ClientId { get; set; }
        public DateTime BookDate { get; set; }
        public int? ScheduleId { get; set; }
        public int SpeedId { get; set; }
        public PickupJobToCreateResponse PickupJob { get;set;}
        public IList<BulkImportJobCreateDto> Jobs { get; set; }
    }
}
