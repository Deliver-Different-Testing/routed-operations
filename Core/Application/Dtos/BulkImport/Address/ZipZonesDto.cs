using System.Collections.Generic;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class ZipZonesDto
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public List<string> ZipCodes { get; set; }
    }
}
