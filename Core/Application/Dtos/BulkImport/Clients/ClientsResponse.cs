using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Clients
{
    public class ClientsResponse : BaseResponse
    {
        public ClientsResponse(Guid messageId) : base(messageId)
        {
        }

        public IEnumerable<ClientDto> Clients { get; set; }

        public bool IsInternal { get; set; }

        public bool IsUsTenant { get; set; }

    }
}
