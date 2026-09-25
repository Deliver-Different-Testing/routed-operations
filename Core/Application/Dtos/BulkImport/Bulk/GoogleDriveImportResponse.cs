using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class GoogleDriveImportResponse : BaseResponse
    {
        public string Data { get; set; }

        public GoogleDriveImportResponse(Guid messageId) : base(messageId)
        {
        }
    }
}
