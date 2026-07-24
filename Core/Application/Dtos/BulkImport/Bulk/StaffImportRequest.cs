using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System.Collections.Generic;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    /// <summary>
    /// Request DTO for Staff Import - allows internal staff to import job data directly from spreadsheet
    /// ClientID is now read from each job's data in the spreadsheet instead of being passed at request level
    /// </summary>
    public class StaffImportRequest : BaseRequest
    {
        /// <summary>
        /// Raw job data from the spreadsheet - each dictionary represents a row with column names as keys.
        /// Each job must contain a ClientID or ClientCode field to identify the client for that job.
        /// </summary>
        public IEnumerable<Dictionary<string, object>> Jobs { get; set; }
    }
}
