using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{

    public class PickupJobRequest : BaseRequest
    {
        public int NumberOfVehicle { get;set;}
        public String VehicleSize { get; set; }
        public PickupJobToCreateDto PickupJob { get; set; }
    }


    public class PickupJobToCreateResponse
    {
        public List<AngularOption> NumberOfVehicles { get; set; }
        public List<AngularOption> VehicleSizes { get; set; }
        public PickupJobToCreateDto PickupJob { get; set; }
    }

    public class AngularOption
    {
        public string label { get; set; }
        public string value { get; set; }
    }
}
