using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class BulkImportRequest : BaseRequest
    {
        public int ClientId { get; set; }
        public DateTime BookDate { get; set; }
        public int? ScheduleId { get; set; }
        public int SpeedId { get; set; }
        public bool isKmRatedJobs { get;set;}
        public bool ImportAsCompleted { get; set; }
        // "ondemand" or "routed". Nullable so a minimal wizard payload
        // (client + jobs) is accepted at bind time; JobType is treated
        // as "routed" by the service when null/blank.
        public string? JobType { get; set; }
        public PickupJobRequest? PickupJob { get; set; }
        public IEnumerable<BulkImportJobCreateDto>? Jobs { get; set; }

        // Steve's 4-step origin precedence (US tenant only):
        //   1. Schedule-derived (existing schedule.RegionNavigation behavior)
        //   2. RouteFromClientSite -> uploaded j.From* fields
        //   3. OriginLocationId   -> selected tblBulkRegion's From*
        //   4. Fail clearly       -> ResolutionError on the job, surface to UI
        // Row-level schedule wins over both batch-level options.
        public bool RouteFromClientSite { get; set; }
        public int? OriginLocationId { get; set; }
    }
}
