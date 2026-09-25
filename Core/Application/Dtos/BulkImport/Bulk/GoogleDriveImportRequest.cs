using System.ComponentModel.DataAnnotations;
using System;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System.Collections.Generic;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class GoogleDriveImportRequest : BaseRequest
    {
        [Required]
        public string FileId { get; set; }

        [Required]
        public string FileName { get; set; }

        [Required]
        public string AccessToken { get; set; }
    }
}
