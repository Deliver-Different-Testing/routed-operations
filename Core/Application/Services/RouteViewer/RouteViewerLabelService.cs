// Route Viewer label-render service. Wraps the AlertLabel package
// (DeliverDifferent.AlertLabel.Data) which owns the QuestPDF composition
// + SSRS token resolution against REP_qryAlertTemplateCell.
//
// P1 SCAFFOLD ONLY. Full implementation lands in P14 once:
//   1. AlertLabel package + SSRS env vars (ReportBase, ReportUsername,
//      ReportPassword, ReportDomain, SSL_CERTIFICATE) are added.
//   2. Section T.5 QUOTED_IDENTIFIER OFF landmine on
//      MAP_stpCourierGPS_CourierTimeTrace_New is decided (unrelated but
//      same P14 landing).
//   3. Section T.6 NZ-hardcoded UTL_stpJob_Topup_Insert_Rated decision
//      resolves the tenant-conditional variant question.
//
// Every method currently throws NotImplementedException with a clear
// P14-TODO message. Endpoints exist so the frontend can wire against
// real routes; UI phase (P3+) will land against 501s until P14 fills in.
using RoutedOperations.Core.Application.Dtos.RouteViewer;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

public class RouteViewerLabelService
{
    private const string P14Todo = "Route Viewer label render lands in P14 (needs AlertLabel package + SSRS env vars).";

    public Task<byte[]> GetSingleJobLabelAsync(int jobId)
        => throw new NotImplementedException($"{P14Todo} GetSingleJobLabelAsync(jobId={jobId}).");

    public Task<byte[]> GetLhpJobLabelAsync(int jobId)
        => throw new NotImplementedException($"{P14Todo} GetLhpJobLabelAsync(jobId={jobId}).");

    public Task<byte[]> GetSingleBulkLabelAsync(int bulkJobId)
        => throw new NotImplementedException($"{P14Todo} GetSingleBulkLabelAsync(bulkJobId={bulkJobId}).");

    public Task<byte[]> GetBulkLabelsAsync(LabelRequest request)
        => throw new NotImplementedException($"{P14Todo} GetBulkLabelsAsync.");

    public Task<byte[]> GetBulkLabelsBySpeedAsync(LabelRequest request)
        => throw new NotImplementedException($"{P14Todo} GetBulkLabelsBySpeedAsync.");

    public Task<byte[]> GetLineHaulLabelsAsync(LabelRequest request)
        => throw new NotImplementedException($"{P14Todo} GetLineHaulLabelsAsync.");

    public Task<string> GetLineHaulManifestCsvAsync(LabelRequest request)
        => throw new NotImplementedException($"{P14Todo} GetLineHaulManifestCsvAsync.");
}
