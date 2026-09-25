// Partial extension for TblBulkJob - adds the RouteId column the Recurring
// Routes Mapped Stops count + drill-down needs. Column pre-exists in the
// shared Despatch DB (verified 2026-08-12 via MCP).
#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TblBulkJob
{
    // The recurring route this job was materialised from. Set by the
    // route resolver at booking time; null for jobs not bound to a route.
    // Powers the "Mapped Stops" count on the Routes tab + the per-route
    // drill-down list.
    public int? RouteId { get; set; }
}
