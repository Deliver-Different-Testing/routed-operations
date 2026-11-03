// Route Viewer partial extending TucJob. Only adds RouteId - NpAgentId
// already exists on the base TucJob.cs at line 490.
//
// A BulkJobId property mapped to column "BulkJobID" used to live here
// (added in 4431287). dbo.tucJob has never had that column on any tenant
// (staging + prod checked 2026-11-03; only BulkParentID exists), so every
// full-entity load of TucJob failed with "Invalid column name 'BulkJobID'".
// Nothing read it, so it was removed rather than adding a column.
#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucJob
{
    /// <summary>FK into dbo.Routes for the recurring-route linkage.
    /// NpScopeGuard.EnsureRouteInScopeAsync checks every non-void
    /// tucJob with RouteId == @routeId to detect mixed-tenant runs.</summary>
    public int? RouteId { get; set; }
}
