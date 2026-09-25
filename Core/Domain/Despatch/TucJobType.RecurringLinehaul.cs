// Partial extension for TucJobType - adds the GroupingId FK the Recurring
// Routes Linehaul port needs to validate Flight-mode runs (IsFlightGroupedSpeedAsync).
// Column pre-exists in the shared Despatch DB with a NOT NULL constraint
// (verified 2026-08-12 via MCP).
#nullable disable
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucJobType
{
    [Column("GroupingID")]
    public int GroupingId { get; set; }

    public string ShortName { get; set; }
}
