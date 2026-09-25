using System;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Common
{
    public class JobDto
    {
        public int Id { get; set; }
        public string JobNumber { get; set; }
        public DateTime BookDate { get; set; }
        public string SpeedName { get; set; }
        public bool IsBulk { get; set; }
        public bool IsParentBulk { get; set; }
        public bool Prebook { get; set; }
        public int? ParentId { get; set; }
    }
}
