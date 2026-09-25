using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System.Collections.Generic;
using System;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class SortZipCodesByLocationResponse : BaseResponse
    {
        public SortZipCodesByLocationResponse(Guid messageId) : base(messageId)
        {
        }
        public IEnumerable<LocationZipcodesDto> Locations { get; set; }
    }
}
