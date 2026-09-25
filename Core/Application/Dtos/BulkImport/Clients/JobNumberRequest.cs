using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Clients
{
    public class JobNumberRequest : BaseRequest
    {
        public int JobNumberId { get; set; }
    }
}
