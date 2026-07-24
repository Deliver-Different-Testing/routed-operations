using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Auth
{
    public class TokenRefreshRequest : BaseRequest
    {
        public string Token { get; set; }
        public string RefreshToken { get; set; }
    }
}
