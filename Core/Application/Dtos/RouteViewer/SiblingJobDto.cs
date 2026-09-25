// Slim shape returned by GET /api/runviewer/runs/job-siblings?jobId=.
// The Related-jobs tab strip on the Detail pane only needs enough info
// to render the tab label + fire a click that switches to the sibling
// (its bulkJobId + status for the render tint).
//
// RVW_stpJobSiblings emits a wide row (30+ columns) but the tabs pane
// consumes just five. Slim DTO keeps the payload tight + avoids the
// EF column-shape brittleness that bit the wider BulkJobDto mapping.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class SiblingJobDto
{
    public int JobId { get; set; }
    public int BulkJobId { get; set; }
    public string? JobNumber { get; set; }

    /// <summary>Abbreviated tab label (e.g. "*LHP", "*LH1", "*DEL", or
    /// the trimmed parent job number for the root row). Derived from
    /// JobNumber suffix on the server so every client renders the
    /// same abbreviation.</summary>
    public string TabLabel { get; set; } = string.Empty;

    /// <summary>Single-char status code (D/A/R/LP/V/P/C/LD/AW/UD/IT/ASC/N/
    /// READY/BUILDING). Empty for voided siblings.</summary>
    public string? JobStatus { get; set; }

    /// <summary>Full BulkJobDto payload for the sibling. Populated
    /// so the frontend tab click can render the sibling's detail
    /// pane WITHOUT another /api/runviewer/jobs/{id} round-trip.
    /// This matters for LH1/LH2/... intermediate linehaul legs
    /// which don't have a tblBulkJob row (BulkJobId = 0), so the
    /// standard single-job endpoint wouldn't find them.</summary>
    public BulkJobDto? Job { get; set; }
}
