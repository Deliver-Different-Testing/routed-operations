using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Common
{
    public class IdRequest : BaseRequest
    {
        public int? Id { get; set; }
    }
}
