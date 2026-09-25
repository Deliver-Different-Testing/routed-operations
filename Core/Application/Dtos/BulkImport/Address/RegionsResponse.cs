using System;
using System.Collections.Generic;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class RegionsResponse : BaseResponse
    {
        public RegionsResponse(Guid messageId) : base(messageId)
        {
        }

        public IEnumerable<RegionDto> Regions { get; set; }
    }
}
