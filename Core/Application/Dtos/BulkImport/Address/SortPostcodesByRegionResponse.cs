using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class SortPostcodesByRegionResponse : BaseResponse
    {
        public SortPostcodesByRegionResponse(Guid messageId) : base(messageId)
        {
        }

        // For NZ - using RegionPostcodesDto
        public IEnumerable<RegionPostcodesDto> Depots { get; set; }

        // For US - using LocationZipcodesDto (kept for backward compatibility)
        public IEnumerable<LocationZipcodesDto> Locations { get; set; }

        // #1017: one line per postcode covered by more than one depot, naming
        // the winning depot and the rule that picked it. Also logged.
        public List<string> Decisions { get; set; } = new List<string>();
    }
}
