using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Clients
{
    public class SchedulesByBookDateRequest : BaseRequest
    {
        public int ClientId { get; set; }
        public DateTime BookDate { get; set; }
        public int SpeedId { get; set; }
        public int DepotId { get; set; }
    }
}
