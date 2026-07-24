using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Common
{
    public class MessageDto
    {
        //public MessageCode Code { get; set; }
        public string Message { get; set; }
        public List<object> Params { get; set; }
    }
}
