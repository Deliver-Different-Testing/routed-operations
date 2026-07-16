using RoutedOperations.Core.Application.Dtos.Job;

namespace RoutedOperations.Core.Application.Dtos.Run;

public class RunDto
{
    public int Id { get; set; }
    public string? Name { get; set; }
    public int? Mins { get; set; }
    public double? Kms { get; set; }
    public int? CourierId { get; set; }
    public string? CourierName { get; set; }
    public int? Status { get; set; }
    public decimal? Revenue { get; set; }
    public decimal? Payout { get; set; }
    public double? CourierPercentage { get; set; }
    public string? GoogleRouteResponse { get; set; }
    public DateTime? DespatchDateTime { get; set; }
    // Routing-mode fields (per Plan §Phase 2 §6, DB migration 20260716210000).
    // NoReroute: driver app must NOT recalculate the sequence.
    // RoutingMode: 0=A-B (default), 1=A-A circuit, 2=FinishAtStop.
    // FinishAtBulkJobId: only meaningful when RoutingMode = 2.
    public bool NoReroute { get; set; }
    public byte RoutingMode { get; set; }
    public int? FinishAtBulkJobId { get; set; }
    // Special "Void Jobs" run marker per legacy homeControl.js:1259.
    // Always rendered locked, with a ban icon prefix.
    public bool IsVoidRun { get; set; }
    // Fleet name for the assigned courier (from tucCourierFleet.UccfName).
    // Legacy SP surfaces this on the run row so operators can filter runs
    // by fleet without cross-referencing the courier list.
    public string? Fleet { get; set; }
    public List<RunJobDto> Jobs { get; set; } = new();
}

public class RunJobDto
{
    public int BulkJobId { get; set; }
    public int? BuilderIndex { get; set; }
    public string? JobNumber { get; set; }
    // Per-run-per-job start/end markers per legacy runBuilder.tpl:50-54.
    public bool IsStart { get; set; }
    public bool IsEnd { get; set; }
    // Extra display fields the Run Builder pane surfaces so operators see the
    // full row context, not just Job # + Order. Legacy runBuilder.tpl:56-65.
    public string? ClientCode { get; set; }
    public DateTime? DeliveryDate { get; set; }
    public string? BookTime { get; set; }
    public string? ToAddress { get; set; }
    public string? ToSuburb { get; set; }
    public int? ToPostCode { get; set; }
    public string? CourierName { get; set; }
    public string? SpeedName { get; set; }
    public string? DeliveryLatitude { get; set; }
    // Job amount is used by the Run Builder totals (Revenue = SUM of Amount).
    public decimal? Amount { get; set; }
}

public class CourierRefDto
{
    public int? CourierId { get; set; }
    public string? Courier { get; set; }
}

/// <summary>
/// Body of POST /api/runs. Mirrors the legacy RunJob so the AngularJS-era
/// cockpit client keeps working during the React cutover.
/// </summary>
public class InsertOrUpdateRunRequest
{
    // Named `Id` (not `ID`) so the CamelCase JSON resolver produces `id` on the
    // wire - `ID` would become `iD` and mismatch the frontend body key.
    public int? Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public int? Mins { get; set; }
    public double? Kms { get; set; }
    public int? Status { get; set; }
    public decimal? Revenue { get; set; }
    public decimal? Payout { get; set; }
    public CourierRefDto? Courier { get; set; }
    public string? CourierPercent { get; set; }
    public object? GoogleRouteResponse { get; set; }
    public List<RunJobDto> Jobs { get; set; } = new();
    // The cockpit stamps this from the current date filter when creating an
    // empty run, so GetBulkRunsAsync can surface it in the runs list even
    // before any jobs are assigned.
    public DateTime? DespatchDateTime { get; set; }
    // Routing-mode fields (Plan §Phase 2 §6). All optional so a legacy client
    // can still POST without them - defaults preserve today's behaviour.
    public bool? NoReroute { get; set; }
    public byte? RoutingMode { get; set; }
    public int? FinishAtBulkJobId { get; set; }
}

public class UpdateJobToRunRequest
{
    public int JobId { get; set; }
    public int? FromRunId { get; set; }
    public int RunId { get; set; }
}

public class SetJobStartEndRequest
{
    // Either flag can be null - service only updates the flags that are set.
    // Setting IsStart = true clears any other start on the run; same for IsEnd.
    public bool? IsStart { get; set; }
    public bool? IsEnd { get; set; }
}

public class DispatchRunsRequest
{
    public List<InsertOrUpdateRunRequest> Runs { get; set; } = new();
}

/// <summary>
/// Send-selected variant of dispatch. Bypasses the "must be in a locked run
/// first" gate and dispatches each selected job directly via the same
/// UTL_stpJob_InsertFromRunBuilder SP. Legacy analogue:
/// $scope.sendSelectedJobsToLive - operators use it when the jobs are correct
/// as-is and building runs first would be overhead.
/// </summary>
public class DispatchJobsRequest
{
    public List<int> JobIds { get; set; } = new();
    public int? CourierId { get; set; }
    public string? RunName { get; set; }
    public int? Status { get; set; }
    public string? CourierPercent { get; set; }
}

public class DispatchResult
{
    public string Result { get; set; } = string.Empty;
    public string? Message { get; set; }
}
