using System.Collections.Generic;
using System;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public class ZipPolygonsResponse : BaseResponse
    {
        public ZipPolygonsResponse(Guid messageId) : base(messageId)
        {
        }

        // Flat list of every ZIP/postcode that has coverage in dbo.ZipPolygon.
        // Loaded once per session and turned into a Set on the client for O(1) lookup.
        public IEnumerable<string> Zips { get; set; }
    }
}
