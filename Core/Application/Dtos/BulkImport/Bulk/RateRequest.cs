using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class RateRequest : BaseRequest
    {
        public int ClientId { get; set; }
        public object RateObject { get; set; }
    }
}
