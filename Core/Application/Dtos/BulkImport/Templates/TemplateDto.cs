using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Templates
{
    public class TemplateDto
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public IEnumerable<TemplateMappingDto> Mappings { get; set; }
    }
}
