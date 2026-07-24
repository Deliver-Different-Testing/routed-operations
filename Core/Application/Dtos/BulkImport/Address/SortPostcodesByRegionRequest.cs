using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class SortPostcodesByRegionRequest : BaseRequest
    {
        public IEnumerable<string> Postcodes { get; set; }
    }
}
