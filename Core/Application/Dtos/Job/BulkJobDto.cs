namespace RoutedOperations.Core.Application.Dtos.Job;

/// <summary>
/// Flat projection of tblBulkJob rows returned to the cockpit. The set of
/// columns is a superset of what the legacy UTL_stpJob_tblBulkJobWithFilter
/// SP returns so the cockpit UI keeps working without a shape change.
/// </summary>
public class BulkJobDto
{
    public int BulkJobId { get; set; }
    public string? JobNumber { get; set; }
    public DateTime BookDate { get; set; }
    public DateTime BookTime { get; set; }
    public int JobStatus { get; set; }
    public int ClientId { get; set; }
    public string? ClientCode { get; set; }
    public decimal? Amount { get; set; }
    public int Speed { get; set; }
    public string? SpeedName { get; set; }
    public string? FromCompany { get; set; }
    public string? FromAddress { get; set; }
    public string? FromSuburb { get; set; }
    public int? FromPostCode { get; set; }
    public string? ToCompany { get; set; }
    public string? ToAddress { get; set; }
    public string? ToSuburb { get; set; }
    public int? ToPostCode { get; set; }
    public int? Size { get; set; }
    public short? Qty { get; set; }
    public decimal? Weight { get; set; }
    public int? CourierId { get; set; }
    public string? CourierName { get; set; }
    public string? ClientRefa { get; set; }
    public string? ClientRefb { get; set; }
    public string? OurRef { get; set; }
    public string? Notes { get; set; }
    public string? PickUpLatitude { get; set; }
    public string? PickUpLongitude { get; set; }
    public string? DeliveryLatitude { get; set; }
    public string? DeliveryLongitude { get; set; }
    public bool? PrebookJob { get; set; }
    public bool OnHold { get; set; }
    public bool Void { get; set; }
    public bool Done { get; set; }
    public int? BulkRunId { get; set; }
    public string? RunName { get; set; }
    public int? RunOrder { get; set; }
    public int? MultiboxParentId { get; set; }
    public int? ParentId { get; set; }
    public int? RegionId { get; set; }
    public string? Barcode { get; set; }
    // Legacy SP UTL_stpJob_tblBulkJobWithFilter aliases tblBulkJob.DeliverToPrivateBusiness
    // AS 'Ok_To_Leave'. Surfaces in JobDetail as "Sig not req" - when true, the
    // driver may leave the parcel without a signature. Nullable to match the
    // column shape (bit NULL); UI treats null as false.
    public bool? OkToLeave { get; set; }

    // ---- Contact / tracking / POD fields (editable via JobDetail pane) ----
    public string? Contact { get; set; }
    public string? DeliverToContact { get; set; }
    public string? DeliverToPhone { get; set; }
    public string? TrackingEmail { get; set; }
    public string? TrackingMobile { get; set; }
    public string? ProofOfDeliveryEmail { get; set; }
    public string? ProofOfDeliveryMobile { get; set; }

    // ---- Delivery Window fields (2026-07-08 feature) ----
    // ScheduleId points at the tblBulkRunSchedule row the job was booked
    // against; ScheduleName is that row's friendly label.
    public int? ScheduleId { get; set; }
    public string? ScheduleName { get; set; }
    // Window is resolved for the target-day sibling schedule (same Name +
    // Client + Speed + Region, matching the run date's weekday). NULL when
    // no schedule exists for that weekday - the frontend treats that as
    // "no valid window" and excludes the job from Delivery Window builds.
    public DateTime? ScheduleWindowStart { get; set; }
    public DateTime? ScheduleWindowEnd { get; set; }
    // Total cubic (m^3) across the job's tblBulkJobItems. Used by the
    // Vehicle Capacity build constraint. 0 = no cubic data recorded.
    public decimal? JobCubicM3 { get; set; }
    // Per-client cap for the Max Boxes build mode. Populated from
    // tucClient.MaxJobsPerRun via join on tblBulkJob.ClientID = tucClient.ucclID.
    // Falls back to 20 client-side when null (matches legacy SP ISNULL(...,20)).
    public int? MaxJobsPerRun { get; set; }
    // Pickup-cutoff hint from tblBulkRunSchedule (Plan §Phase 2 §6.5). Non-null
    // when the schedule has ApplyPickupCutoff = 1; means the run must finish
    // its pickup leg no later than PickupCutoffHours before the delivery
    // window end. Route Builder feeds this into splitOrderedJobsByConstraints
    // when the operator ticks "Respect pickup cutoff" in the build config.
    public bool? ApplyPickupCutoff { get; set; }
    public int? PickupCutoffHours { get; set; }
    // Postcode-run-name lookup surfaced from TblBulkPostCodeRunName. Legacy
    // SP: ISNULL(rn.RunName, ToPostCode) AS PrefixRunName, rn.PostCodeMergeTo,
    // ISNULL(rn.RunSequence, 0). PrefixRunName is used by Max Boxes build
    // mode to group jobs by RunName; PostCodeMergeTo folds two adjacent
    // postcodes into a single run bucket.
    public string? PrefixRunName { get; set; }
    public string? PostCodeMergeTo { get; set; }
    public int RunSequence { get; set; }
    // ID of the tblBulkJobRun link row. Used by legacy transfer flow to
    // detect membership without another round-trip. 0 when the job isn't
    // on a run.
    public int BulkJobRunId { get; set; }
}
