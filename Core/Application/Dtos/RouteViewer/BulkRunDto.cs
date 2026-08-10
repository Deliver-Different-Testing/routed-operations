// Run-list row for the Route Viewer Home module. Sourced from
// RVW_stpBulkRuns_2 + RVW_stpGetMissingJobRuns (merged into one list;
// missing-scan branch stamps IsMissing=true). Field-level shape locked in
// Runviewer-migration-tasktodo.md Section 16.6.
//
// CRITICAL contract notes captured from the 11-loop verification cycle:
//
// - `area` is INTENTIONALLY lowercase in JSON (per Section 16.6 field shape).
//   Newtonsoft's camelCase policy emits it as `"area"`. React binding must
//   match; do NOT rename to `Area` for consistency.
//
// - `IsActive` and `PreAssigned` are typed int (0/1), NOT bool. JSON payload
//   sends 0/1 not true/false. React consumers must accept the numeric type
//   or the sort/filter logic silently misbehaves.
//
// - `Velocity` is an overloaded chip label: "Medical" / "Standard" /
//   "Express" OR the raw speed name for real-bulkrun rows. Route Viewer
//   displays verbatim, no client-side substitution.
//
// - `Status` string values include "READY" post-2026-07-07 (Loop 8 SP body
//   audit confirmed both NZ + US emit READY; earlier docs said NZ still
//   emits BUILDING - that was stale, ignore). Also add "N" (new) via
//   Track C Option B, which needs a matching .status.N blue CSS rule.
//
// - `HashKey` is a deterministic content-hash. React should re-render the
//   row only when HashKey changes to avoid flicker on 25-second polls.
//
// - `CourierPercentageFormatted` is a pre-formatted "NN.NN%" string built
//   server-side to avoid locale-sensitive float parsing on the client.
//   Do NOT convert back to decimal.
//
// - `IsMissing` is populated by the RVW_stpGetMissingJobRuns branch merged
//   into the same list; drives the missing-tint category on runList.
//
// Trimmed from the full 24-property VM in RunViewer legacy - additional
// fields (returns metadata, per-role scan counts) get added when the
// consuming UI phase (P3) actually reads them. Do NOT prematurely expand.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class BulkRunDto
{
    /// <summary>tblBulkRun.BulkRunID (or synthetic negative id for a
    /// Route Runs row derived from tucJobBooking).</summary>
    public int Id { get; set; }

    /// <summary>Human-facing run name (e.g. "RNO200", "K-East").</summary>
    public string? Name { get; set; }

    /// <summary>Region label. INTENTIONALLY lowercase in JSON.</summary>
    public string? area { get; set; }

    /// <summary>Semi-colon-joined suburb list; drives the title=Suburbs
    /// tooltip on the runList row.</summary>
    public string? Suburbs { get; set; }

    /// <summary>SP-emitted "FromCities" - concatenated pickup cities
    /// from LHP-leg pickup lines. Populated on synthetic route-runs;
    /// empty on real-bulk runs. Feeds the Run List "From" column
    /// (legacy: fromCities || pickupCity || suburbs || '').</summary>
    public string? FromCities { get; set; }

    /// <summary>SP-emitted "ToLocationName" - LHP-destination depot
    /// name from tblBulkRegion. Populated on synthetic route-runs;
    /// empty on real-bulk runs (which fall back to Area). Feeds the
    /// Run List "To" column (legacy: toLocationName || area || '').</summary>
    public string? ToLocationName { get; set; }

    /// <summary>Overloaded chip: Medical / Standard / Express for real
    /// runs, speed name for synthetic Route Runs.</summary>
    public string? Velocity { get; set; }

    /// <summary>Deterministic content-hash - React re-renders only when
    /// this value changes across polls.</summary>
    public string? HashKey { get; set; }

    /// <summary>SP-emitted status literal (D / A / R / LP / V / P / C /
    /// LD / AW / UD / IT / ASC / N / READY / BUILDING).</summary>
    public string? Status { get; set; }

    /// <summary>Total job count on the run (view-mode agnostic).</summary>
    public int Jobs { get; set; }

    /// <summary>Incomplete-job count. Combined-view row math derives from
    /// Jobs - IncompleteJobs = completed count.</summary>
    public int IncompleteJobs { get; set; }

    /// <summary>LHP-leg count for synthetic Route Runs; 0 for real bulk
    /// runs. Drives Inbound-mode row counts on runList.</summary>
    public int TotalPickup { get; set; }

    public int IncompletePickup { get; set; }

    /// <summary>true when any job on the run is a return leg.</summary>
    public bool HasReturns { get; set; }

    public int ReturnsTotal { get; set; }

    /// <summary>Populated by RVW_stpGetMissingJobRuns branch merge -
    /// drives the missing-tint category on runList.</summary>
    public bool IsMissing { get; set; }

    /// <summary>Pre-assign flag from tblBulkJobRun. Typed int (0/1), NOT
    /// bool. Drives the P badge + gates the right-click menu (only
    /// run.id >= 0 real runs are pre-assignable; synthetic negative-id
    /// runs are excluded).</summary>
    public int PreAssigned { get; set; }

    /// <summary>Active flag. Typed int (0/1), NOT bool - JSON emits 0/1
    /// not true/false; React must accept numeric.</summary>
    public int IsActive { get; set; }

    /// <summary>Courier identity: display name for cell subtitle.</summary>
    public string? CourierName { get; set; }

    /// <summary>Courier code for cell subtitle - rendered as
    /// "{Name}:{Code}" with a `:` separator; separator MUST be skipped
    /// when CourierName is null (Loop 5 stray-colon fix 2026-06-24).</summary>
    public string? CourierCode { get; set; }

    /// <summary>Pre-formatted "NN.NN%" string built server-side.
    /// Do NOT parse client-side; locale-sensitive.</summary>
    public string? CourierPercentageFormatted { get; set; }

    /// <summary>Feeds the courier-online dot indicator on runList.</summary>
    public string? CourierOnlineStatus { get; set; }

    /// <summary>Courier offline minutes, string not int - matches SP
    /// output shape (renders as "45m" or "-").</summary>
    public string? CourierOfflineMins { get; set; }

    /// <summary>Agent display name; NP badge shown when IsNpAgent=true.</summary>
    public string? AgentName { get; set; }

    public bool IsNpAgent { get; set; }
}
