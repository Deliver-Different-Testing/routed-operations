// Route Viewer partial extending TblBulkJob with NpAgentId. Consumed by
// NpScopeGuard.EnsureBulkJobInScopeAsync.
//
// NOTE: A `PodTime` property was previously here mapped to a column
// `PODTime` on tblBulkJob - that column does NOT exist in the tenant
// schema. POD completion time lives on `tblJob.CompletedTime` and is
// exposed via a raw SQL join in RouteViewerJobService (see
// GetBulkJobPhotosAsync). Adding a fabricated column mapping here
// broke every EF query touching TblBulkJob (SqlException "Invalid
// column name 'PODTime'" on /api/runs 2026-08-08). Do not re-add.
#nullable disable

using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TblBulkJob
{
    [Column("NpAgentID")]
    public int? NpAgentId { get; set; }
}
