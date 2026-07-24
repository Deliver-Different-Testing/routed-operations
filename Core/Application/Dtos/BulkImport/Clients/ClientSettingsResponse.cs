using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Clients
{
    public class ClientSettingsResponse : BaseResponse
    {
        public ClientSettingsResponse(Guid messageId) : base(messageId)
        {
        }

        public ClientSettingsDto Settings { get; set; }

    }
}
