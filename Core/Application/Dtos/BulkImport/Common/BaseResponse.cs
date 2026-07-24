using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Common
{
    public class BaseResponse
    {
        public BaseResponse(Guid messageId)
        {
            MessageId = messageId;
            Messages = new List<MessageDto>();
        }
        public Guid MessageId { get; }
        public bool Success { get; set; }
        public List<MessageDto> Messages { get; set; }
    }
}
