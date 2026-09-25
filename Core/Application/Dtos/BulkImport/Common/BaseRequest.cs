using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Common
{
    public class BaseRequest
    {
        public BaseRequest()
        {
            MessageId = Guid.NewGuid();
        }

        public Guid MessageId { get; set; }
    }
}
