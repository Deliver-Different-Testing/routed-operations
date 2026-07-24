using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Templates
{
    public class TemplateResponse : BaseResponse
    {
        public TemplateResponse(Guid messageId) : base(messageId)
        {
        }

        public TemplateDto Template { get; set; }
    }
}
