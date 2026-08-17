// The primary job DTO consumed by every Route Viewer module (Home
// runBuilder + Print Manager + Linehaul + CS + Mobile). Field-level shape
// captured across master Section 16.5-16.7 with 11-loop verification
// annotations preserved inline so a naive port cannot drop a subtle
// contract.
//
// This is the P1 essentials subset (~30 of the 55+ properties on the
// legacy VM). Additional fields added as their consuming UI phase (P3,
// P5, P9, P11) actually reads them - do NOT prematurely expand or the
// SP row-mapper starts throwing on missing columns for tenants that
// have not been backfilled.
//
// Sourced from RVW_stpBulkRunJobs (Home runBuilder), RVW_stpJobSiblings
// (Detail Related-tabs), RVW_stpBulkJob (single-job read), and the
// print-specific RVW_stpPrintJobsV2 (Print Manager grid). The same DTO
// serves all four; unmapped columns are null.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class BulkJobDto
{
    /// <summary>tucJob.ucjbID - the live job id. 0 for jobs that live only
    /// as bulk (not yet materialised into tucJob).</summary>
    public int JobId { get; set; }

    /// <summary>tblBulkJob.BulkJobID - the parent bulk job id.</summary>
    public int BulkJobId { get; set; }

    /// <summary>Populated from tucJob.ParentID via RVW_stpBulkRunJobs +
    /// RVW_stpJobSiblings (added migration 20260526150000). NULL for
    /// parent rows; populated for LHP/DEL/LH1..6 legs. Drives the
    /// Related-jobs tab strip grouping. NOTE: RVW_stpBulkJob single-job
    /// SP does NOT project this column (T.8) - client-side must fall
    /// back to jobNumber-suffix heuristic when null.</summary>
    public int? ParentJobId { get; set; }

    public string? JobNumber { get; set; }

    public string? ClientCode { get; set; }

    public int? ClientId { get; set; }

    public DateOnly? DeliveryDate { get; set; }

    /// <summary>Delivery-side ready time (HH:mm string as SP emits).</summary>
    public string? ReadyTime { get; set; }

    /// <summary>Pickup-side booked start proxy. Distinct from PickedUpTime
    /// (actual completion) and from ReadyTime (delivery leg).</summary>
    public string? PickupReadyTime { get; set; }

    /// <summary>Pre-formatted "HH:mm:ss - HH:mm:ss" string (SQL CONVERT
    /// style 108 - T.3 correction). React should strip trailing ":00"
    /// seconds before display. Coexists with the DateTime window fields
    /// below; both surface in the payload.</summary>
    public string? PickupWindow { get; set; }

    /// <summary>Compute-on-read window boundaries added 2026-06-24 Option
    /// B. Not persisted; SP derives on read from tblClientJobType >
    /// tucJobType offsets applied to booked start.</summary>
    public DateTime? PickupWindowStart { get; set; }
    public DateTime? PickupWindowEnd { get; set; }
    public DateTime? DeliveryWindowStart { get; set; }
    public DateTime? DeliveryWindowEnd { get; set; }

    public string? FromAddress { get; set; }
    public string? ToAddress { get; set; }

    public string? FromSuburb { get; set; }
    public string? ToSuburb { get; set; }

    public decimal? PickUpLatitude { get; set; }
    public decimal? PickUpLongitude { get; set; }
    public decimal? ToLat { get; set; }
    public decimal? ToLng { get; set; }

    /// <summary>Item 11 pickup-side rich data (2026-06-05 batch).
    /// Populates the Inbound + Combined viewMode tiles on jobDetail.</summary>
    public string? PickupFromContact { get; set; }
    public string? PickupFromPhone { get; set; }
    public string? PickupCompany { get; set; }

    /// <summary>Two separate notes streams from tucJob columns; distinct
    /// from the general Notes field (ucjbNotes).</summary>
    public string? ClientNotes { get; set; }
    public string? InternalNotes { get; set; }

    /// <summary>General notes (ucjbNotes). Notes-field write path is
    /// verbatim (RVW_stpUpdateJob Notes-field special case - no audit
    /// prepend, unlike other fields). Silent-regression risk if the
    /// React edit path is wired to the wrong SP branch.</summary>
    public string? Notes { get; set; }

    public string? PickedUpBy { get; set; }
    public DateTime? PickedUpTime { get; set; }

    public DateTime? DispatchedTime { get; set; }

    /// <summary>Booked-at datetime. Sourced from tucJobBooking.CreatedTime
    /// (no separate ucbkBookedTime column exists).</summary>
    public DateTime? CreatedDate { get; set; }

    /// <summary>Delivery-side POD identity + time (distinct from
    /// PickedUpBy/PickedUpTime). CAUTION - RVW_stpJobSiblings uses the
    /// same column names to project PICKUP-side data (T.3 collision);
    /// Related-tabs render must alias these appropriately.</summary>
    public string? PODName { get; set; }
    public DateTime? PODTime { get; set; }

    /// <summary>Both fields populated - do NOT conflate. Sort-by-speed
    /// uses SpeedID, header display uses Speed.</summary>
    public string? Speed { get; set; }
    public int? SpeedID { get; set; }

    public int? CourierId { get; set; }
    public string? CourierCode { get; set; }
    public string? CourierName { get; set; }
    public string? CourierPhone { get; set; }

    public int? AgentId { get; set; }
    public string? AgentName { get; set; }
    public bool IsNpAgent { get; set; }

    public int? RunOrder { get; set; }

    public string? JobStatus { get; set; }

    /// <summary>Return-leg flag. Renders autorenew badge in job grid.</summary>
    public bool Return { get; set; }

    /// <summary>Client-has-intel flag. Drives right-click menu item
    /// visibility for "Open Client Intel".</summary>
    public bool ClientIntel { get; set; }

    /// <summary>Pre-formatted tracking URL from SP for Copy Link
    /// right-click handler. Distinct from client-side generateDirectLink
    /// in CS module.</summary>
    public string? TrackingLink { get; set; }

    /// <summary>MULTI-BOX flag. VM casing is MultiBox (NOT Multibox as
    /// on the entity); JSON contract uses MultiBox.</summary>
    public bool MultiBox { get; set; }

    /// <summary>ucjbPickUpFrom int FK. MUST be typed int? (not string) -
    /// row-mapper only Convert.ChangeType-s for IsPrimitive target types.
    /// See B.6.1 / Section 16.4 landmine.</summary>
    public int? PickupLocation { get; set; }

    /// <summary>Tri-state scan flags: 0/1/2 = red/yellow/green rendering
    /// (T.4 correction). ONLY Sort and Run are true tri-state; the other
    /// four are binary 0/1 despite the same byte type. React renders
    /// yellow for value 1 on Sort/Run only.</summary>
    public byte SortScanned { get; set; }
    public byte RunScanned { get; set; }
    public byte PickScanned { get; set; }
    public byte InvalidPickScanned { get; set; }
    public byte TransferScanned { get; set; }
    public byte TransitScanned { get; set; }

    // -----------------------------------------------------------------
    // Extra fields consumed by the Route Viewer Detail pane (2026-08-08).
    // Every SP that populates BulkJobDto (RVW_stpBulkRunJobs +
    // RVW_stpBulkJob + RVW_stpJobSiblings + RVW_stpPrintJobsV2) returns
    // most of these as native columns. Adding them here lets the mapping
    // layer forward the values to the frontend without a rename.
    // -----------------------------------------------------------------

    /// <summary>Job total in tenant currency (money column on
    /// tblBulkJob / tucJob). Frontend renders as PRICING tile.</summary>
    public decimal? Amount { get; set; }

    /// <summary>Package size code (int on the tables; frontend surface
    /// treats as string so it can show blank on missing values).</summary>
    public string? Size { get; set; }

    /// <summary>Item count. Backed by smallint columns Qty / ucjbQty.</summary>
    public short? Qty { get; set; }

    /// <summary>Job weight in kg.</summary>
    public decimal? Weight { get; set; }

    /// <summary>Reference codes surfaced on the Job info card.</summary>
    public string? RefA { get; set; }
    public string? RefB { get; set; }
    public string? OurRef { get; set; }

    /// <summary>Pickup-side company. Sourced from PickupAddressLine1
    /// (RVW_stpBulkRunJobs) or the address bag fallback.</summary>
    public string? FromCompany { get; set; }

    /// <summary>Delivery-side company (tblBulkJob.ToCompany +
    /// tucJob.DeliveryAddressLine1 fallback).</summary>
    public string? ToCompany { get; set; }

    /// <summary>Delivery-side contact + phone (tblBulkJob.DeliverToContact
    /// / DeliverToPhone). Distinct from PickupFromContact /
    /// PickupFromPhone.</summary>
    public string? DeliverToContact { get; set; }
    public string? DeliverToPhone { get; set; }

    /// <summary>Tracking email + POD delivery mobile / email.</summary>
    public string? TrackingEmail { get; set; }
    public string? ProofOfDeliveryEmail { get; set; }
    public string? ProofOfDeliveryMobile { get; set; }

    /// <summary>Book date (delivery-side date HH:MM string as SP emits
    /// via CONVERT(varchar, ..., 103)) + book time.</summary>
    public string? BookDate { get; set; }
    public string? BookTime { get; set; }

    /// <summary>Delivery-notes stream. Currently the SP surfaces general
    /// Notes only; DeliveryNotes stays a placeholder that the Detail
    /// pane can render side-by-side with Notes without a null crash.</summary>
    public string? DeliveryNotes { get; set; }

    /// <summary>Agent type label ("Depot" / "Retail" etc.). Sourced from
    /// tucAgents metadata when the SP joins to it.</summary>
    public string? AgentType { get; set; }

    /// <summary>Run + bulk-run linkage for the Detail's Info strip
    /// + the map's "highlight this job's pins" flow.</summary>
    public string? RunName { get; set; }
    public int? BulkRunId { get; set; }
    public int? RegionId { get; set; }

    /// <summary>Postcodes for pickup + delivery. Both SPs
    /// (RVW_stpBulkRunJobs + RVW_stpBulkJob) emit these; needed by
    /// the GPS edit modal.</summary>
    public int? FromPostCode { get; set; }
    public int? ToPostCode { get; set; }

    /// <summary>Pickup + delivery city labels. RVW_stpBulkRunJobs +
    /// RVW_stpJobSiblings emit these as separate columns; the Run-jobs
    /// grid uses ToCity as the legacy `City` column.</summary>
    public string? FromCity { get; set; }
    public string? ToCity { get; set; }

    /// <summary>Scan history JSON string emitted by RVW_stpLinehaulJobs
    /// (2026-07-01 SP change). Array of { ScanDateTime, ScanType, Courier }
    /// with the most recent scan first, capped at 20 entries. Empty JSON
    /// array (`[]`) when the parent job has no scans in the last 3 days.
    /// Consumed by the Linehaul jobs table Scanned cell which parses per
    /// row and renders one chip per entry. Only RVW_stpLinehaulJobs emits
    /// this today; other SPs feeding BulkJobDto leave it null.</summary>
    public string? ScanHistory { get; set; }
}
