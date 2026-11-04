using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Common
{
    public class SpeedDto
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public string Code { get; set; }
        public string SystemName { get; set; }
        // A speed bulk import sends down the truck path. Drives the wizard's truck fields.
        public bool IsTruck { get; set; }
    }
}
