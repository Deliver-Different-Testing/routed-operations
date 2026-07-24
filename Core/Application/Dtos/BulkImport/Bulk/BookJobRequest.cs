using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class BookJobRequest : BaseRequest
    {
        public int ClientId { get; set; }
        public object JobObject { get; set; }
    }
}
