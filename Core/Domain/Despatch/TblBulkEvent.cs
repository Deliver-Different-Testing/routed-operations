// Customer service event log. Route Viewer's CS module (P12) reads
// tblBulkEvent to render the event list + reply threading + Include
// Closed filter + admin-only Follow-up radio (All / UCL / Client).
// Writes go through RVW_stpCreateBulkEvent + RVW_stpCloseEvent SPs, so
// EF here is READ-side + occasional set-columns via ExecuteUpdateAsync
// (matches the Configurator pattern for tblBulkEvent.ClosedDate /
// ClosedByName).
//
// NOTE: this table does NOT currently carry an NpAgentId column
// (T.1 SECURITY finding in the migration audit). Route Viewer's CS
// controller short-circuits to empty for NP users pending the
// downstream migration + backfill decision. See Section Z of
// Runviewer-migration-tasktodo.md.
#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tblBulkEvent")]
public partial class TblBulkEvent
{
    [Key]
    public int BulkEventId { get; set; }

    public int? BulkJobId { get; set; }

    public int? CourierId { get; set; }

    public string Notes { get; set; }

    /// <summary>true = event is internal to UCL / ops (not visible to
    /// the client). Drives the "Client Visible?" checkbox on the create
    /// dialog (stored inverted).</summary>
    public bool Internal { get; set; }

    /// <summary>true = the follow-up owner is the client (not UCL ops).
    /// Populates the CS Follow-up radio "Client" bucket. When both
    /// Internal and ClientFollowup are false, the event is owned by UCL
    /// and visible to the client.</summary>
    public bool ClientFollowup { get; set; }

    /// <summary>true = the event was created BY the client (via the
    /// public tracking page). false = event was created by UCL ops.
    /// Distinct from Internal / ClientFollowup.</summary>
    public bool ClientCreated { get; set; }

    [MaxLength(200)]
    public string CreatedByName { get; set; }

    public DateOnly EventDate { get; set; }

    [Column(TypeName = "datetime")]
    public DateTime Created { get; set; }

    [Column(TypeName = "datetime")]
    public DateTime? ClosedDate { get; set; }

    [MaxLength(200)]
    public string ClosedByName { get; set; }

    [ForeignKey(nameof(BulkJobId))]
    public virtual TblBulkJob BulkJob { get; set; }

    [ForeignKey(nameof(CourierId))]
    public virtual TucCourier Courier { get; set; }
}
