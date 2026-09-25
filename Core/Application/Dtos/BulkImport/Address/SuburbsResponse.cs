using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class SuburbsResponse : BaseResponse
    {
        public SuburbsResponse(Guid messageId) : base(messageId)
        {
        }

        public IEnumerable<SuburbDto> Suburbs { get; set; }

    }
}
