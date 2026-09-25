using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Auth
{
    public class TokenAccessKeyRequest : BaseRequest
    {
        public string AccessKey { get; set; }
        public string CountryCode { get; set; }
        public string ConnectionString { get; set; }
        public string TimeZone { get; set; }
        public bool IsInternal { get; set; }
        public string TenantId { get; set; }
    }
}
