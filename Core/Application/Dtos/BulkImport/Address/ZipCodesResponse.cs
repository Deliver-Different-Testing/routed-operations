using System.Collections.Generic;
using System;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class ZipCodesResponse: BaseResponse
    {
        public ZipCodesResponse(Guid messageId) : base(messageId)
        {
        }

        public IEnumerable<ZipCodeDto> ZipCodes { get; set; }
    }
}
