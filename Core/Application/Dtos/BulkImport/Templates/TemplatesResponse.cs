using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Templates
{
    public class TemplatesResponse : BaseResponse
    {
        public TemplatesResponse(Guid messageId) : base(messageId)
        {
        }

        public IEnumerable<TemplateDto> Templates { get; set; }
    }
}
