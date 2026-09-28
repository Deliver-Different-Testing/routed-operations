using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class RegionPostcodesDto
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public IEnumerable<string> Postcodes { get; set; }

        // False when the request named a client and this depot has no
        // bookable schedule for it. Always true when no client was given.
        public bool HasSchedules { get; set; } = true;
    }
}
