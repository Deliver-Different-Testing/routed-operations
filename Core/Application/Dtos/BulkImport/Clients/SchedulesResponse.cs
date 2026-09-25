using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Clients
{
    public class SchedulesResponse : BaseResponse
    {
        public SchedulesResponse(Guid messageId) : base(messageId)
        {
        }

        public IEnumerable<ScheduleDto> Schedules { get; set; }
    }
}
