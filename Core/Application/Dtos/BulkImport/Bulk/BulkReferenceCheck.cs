using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    // POST /api/bulk-import/reference-check. Writes nothing.
    public class BulkReferenceCheckRequest : BaseRequest
    {
        public List<BulkReferenceCheckRow>? Rows { get; set; }
    }

    public class BulkReferenceCheckRow
    {
        public int RowNumber { get; set; }
        public int? ClientId { get; set; }
        // Staff Import files may name the client by code. Used only with no ClientId.
        public string? ClientCode { get; set; }
        public string? ReferenceA { get; set; }
        public string? ReferenceB { get; set; }
    }

    public class BulkReferenceCheckError
    {
        public int RowNumber { get; set; }
        public string Error { get; set; } = "";
    }

    public class BulkReferenceCheckResponse : BaseResponse
    {
        public BulkReferenceCheckResponse(Guid messageId) : base(messageId)
        {
        }

        // Only the rows that would be refused, in the order they were sent.
        public List<BulkReferenceCheckError> Errors { get; set; } = new();
    }
}
