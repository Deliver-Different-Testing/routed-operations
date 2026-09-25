using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Auth
{
    public class TokenResponse : BaseResponse
    {
        public TokenResponse(Guid messageId) : base(messageId)
        {
        }

        public TokenDto Results { get; set; }
    }
}
