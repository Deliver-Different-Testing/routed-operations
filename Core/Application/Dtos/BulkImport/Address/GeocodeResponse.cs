using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class GeocodeResponse : BaseResponse
    {
        public GeocodeResponse(Guid messageId) : base(messageId)
        {
        }
        public IEnumerable<GeocodeAddressDto> Addresses { get; set; }
    }
}
