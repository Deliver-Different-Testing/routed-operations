// Recurring Linehaul partial extending TucJob. Adds LinehaulRunId only.
//
// Why this is needed (Bug 3, Steve's 2026-09-25 linehaul spec):
// WS_/DD_stpBulkScheduleJob_InsertChildJobs writes a linehaul leg's child
// job to ONE of two tables, chosen by the leg's InsertToBulk flag:
//
//     IF @InsertToBulk = 1 BEGIN
//         INSERT INTO tblBulkJob ( ..., LinehaulRunID, ... )
//     END ELSE BEGIN
//         INSERT INTO tucJob   ( ..., LinehaulRunId, ... )
//     END
//
// The Mapped Stops read path only knew about tblBulkJob, so on a tenant
// whose legs are InsertToBulk = 0 the list came back empty. Mapping the
// column here lets the read path UNION both sources.
//
// The value is TblbulkLinehaulRun.Id, NOT the tblBulkScheduleLinehaul PK.
// Steve's 2026-06-30 handover said the leg PK was stamped here; that was
// reverted the same day and the SP comment records it ("source
// LinehaulRunID is the cursor's tblBulkScheduleLinehaul.LinehaulRunID
// column (FK-style ref to TblbulkLinehaulRun.Id), NOT the schedule
// linehaul PK"). @ScheduleLinehaulId is still fetched by the cursor but
// no SP reads it.
//
// No [Column] attribute: the physical column really is LinehaulRunId, so
// the by-convention mapping is correct. Verified on all four tenants
// 2026-09-30, along with the supporting index:
//   urgent-prod / medical-prod / NZ staging / US staging all have
//   dbo.tucJob.LinehaulRunId plus a nonclustered index keyed on it.
// No DespatchContext fluent config change and no GRANT migration are
// needed - InternetUser already holds table-level SELECT on dbo.tucJob
// on all four tenants.
#nullable disable

namespace RoutedOperations.Core.Domain.Despatch;

public partial class TucJob
{
    /// <summary>FK-style reference to TblbulkLinehaulRun.Id, stamped by the
    /// InsertToBulk = 0 branch of WS_/DD_stpBulkScheduleJob_InsertChildJobs.
    /// Null on every job that is not a linehaul leg child.</summary>
    public int? LinehaulRunId { get; set; }
}
