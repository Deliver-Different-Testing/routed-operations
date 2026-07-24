using RoutedOperations.Core.Domain.Despatch;
using System.Collections.Generic;
using System;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class ZipCodeDto
    {
        public int Id { get; set; }

        public int? ZoneNumber { get; set; }

        public string ZoneName { get; set; }

        public string Zip { get; set; }

        public int? ClientId { get; set; }

        public bool? ApplyCongestion { get; set; }
    }
}
