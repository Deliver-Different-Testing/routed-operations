using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class SuburbDto
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public string City { get; set; }
        public string PostCode { get; set; }
        public string Alias { get; set; }
        public string GoogleAlias { get; set; }
    }
}
