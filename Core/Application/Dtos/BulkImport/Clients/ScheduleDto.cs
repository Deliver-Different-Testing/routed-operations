using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using RoutedOperations.Core.Domain.Despatch;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Clients
{
    public class ScheduleDto
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public short DayOfWeek { get; set; }
        public TimeSpan StartTime { get; set; }
        public int CutoffHours { get; set; }
        public SpeedDto Speed { get; set; }
        public int DepotId { get; set; }
    }
}
