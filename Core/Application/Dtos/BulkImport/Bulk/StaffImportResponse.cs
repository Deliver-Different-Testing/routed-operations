using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System.Collections.Generic;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    /// <summary>
    /// Response DTO for Staff Import operations
    /// </summary>
    public class StaffImportResponse : BaseResponse
    {
        public StaffImportResponse(System.Guid messageId) : base(messageId)
        {
        }

        public int SuccessCount { get; set; }
        public int FailedCount { get; set; }
        public List<FailedJobDto> FailedJobs { get; set; } = new List<FailedJobDto>();
    }

    public class FailedJobDto
    {
        public int RowNumber { get; set; }
        public string JobNumber { get; set; }
        public string Error { get; set; }
    }
}
