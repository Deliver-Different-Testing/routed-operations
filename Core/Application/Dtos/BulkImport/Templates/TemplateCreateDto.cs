using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Templates
{
    public class TemplateCreateDto
    {
        public string Name { get; set; }
        public IEnumerable<TemplateMappingDto> Mappings { get; set; }
    }
}
