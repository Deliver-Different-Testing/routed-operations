using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Auth
{
    public class TokenDto
    {
        public string Token { get; set; }
        public DateTime Expires { get; set; }
        public string RefreshToken { get; set; }
        public bool IsInternal { get; set; }
    }
}
