// Route Viewer partial extending TucJob. Only adds BulkJobId (nullable
// FK back to tblBulkJob) - NpAgentId already exists on the base
// TucJob.cs at line 490.
//
// BulkJobId lets NpScopeGuard.EnsureTucJobByNumberInScopeAsync resolve
// the bulk parent when guarding by job number without a second query.
#nullable disable

using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucJob
{
    [Column("BulkJobID")]
    public int? BulkJobId { get; set; }

    /// <summary>FK into dbo.Routes for the recurring-route linkage.
    /// NpScopeGuard.EnsureRouteInScopeAsync checks every non-void
    /// tucJob with RouteId == @routeId to detect mixed-tenant runs.</summary>
    public int? RouteId { get; set; }
}
