using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class FileUploadResponse : BaseResponse
    {
        public FileUploadResponse(Guid messageId) : base(messageId)
        {
        }

        public DataTable Results { get; set; }
    }
}
