using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Clients
{
    public class JobNumberResponse : BaseResponse
    {
        public JobNumberResponse(Guid messageId) : base(messageId)
        {
        }

        public IEnumerable<JobNumberDto> JobNumber { get; set; }

    }
}
