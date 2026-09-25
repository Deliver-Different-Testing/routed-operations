using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Clients
{
    public class ClientSettingsDto
    {
        public int Id { get; set; }
        public string Code { get; set; }
        public string Name { get; set; }
        public string JobPrefix { get; set; }
        public bool IsUsTenant { get; set; } = false;
        public IEnumerable<ContactDto> Contacts { get; set; }
        public IEnumerable<SpeedDto> Speeds { get; set; }
        public IEnumerable<StockSizeDto> StockSizes { get; set; }
        public IEnumerable<ScheduleDto> Schedules { get; set; }

        // Per-client "Reference A / B" requirements. The booking SP enforces
        // these flags too (DD_stpJob_InsertExcelerator -> "Require ..."), so
        // surfacing them to the frontend lets the user resolve the gap at Step 2
        // (column mapping) instead of being blocked at the final book step.
        public bool ReferenceAMandatory { get; set; }
        public string ReferenceAMessage { get; set; }
        public bool ReferenceBMandatory { get; set; }
        public string ReferenceBMessage { get; set; }

        // Surfaces tucClient.CreateBulkHomeDeliveryPickup so the wizard can
        // decide whether to show the Step 8 pickup-booking modal. Server
        // still gates the actual /import response.PickupJob attachment on
        // this flag (see BulkImportJobFactory client.CreatBulkHomeDeliveryPickupJob).
        public bool CreateBulkHomeDeliveryPickup { get; set; }
    }
}
