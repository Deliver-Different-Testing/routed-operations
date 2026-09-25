// Scan Manager DTOs. Covers both Bulk-mode + Routed-mode grids +
// the Scan Detail panel + the item-progress lazy fetch.
//
// CRITICAL contract notes from the 11-loop verification cycle:
//
// - RoutedScanJobDto.Legs is a JSON string that React must JSON.parse
//   per-row to a { Leg, LinehaulRunId, LinehaulRunName, ToDepot, State,
//   PackedRole } array (Loop 3 + Section 16.7).
//
// - RoutedShipmentDetailDto has 5 JSON-string columns that React
//   double-parses (Totes.ActiveItems is a JSON string inside a Tote row
//   that itself needs a second JSON.parse - Loop 2 + Section 10.9).
//
// - BulkScanDetailDto class name IS BulkScanDetail (not ScanDetail as
//   Loop 1 incorrectly corrected + Loop 3 reverted). Section 16.2.
//
// - Tri-state scan flags on BulkScanJobDto: T.4 correction applies -
//   only Sort + Run are tri-state 0/1/2; the other four are binary
//   0/1 despite the byte type.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

/// <summary>
/// Bulk-mode Scan Manager grid row. Sourced from RVW_stpScanJobs.
/// Sort + Run are tri-state; Pick + InvalidPick + Transfer + Transit
/// are binary despite same byte type (T.4 correction).
/// </summary>
public class BulkScanJobDto
{
    public int BulkJobId { get; set; }
    public int? BulkParentId { get; set; }
    public string? JobNumber { get; set; }
    public string? ClientCode { get; set; }
    /// <summary>Pre-formatted "dd/MM/yyyy" string from SP CONVERT(103).
    /// Not DateOnly - the SP emits varchar so we pass through as string
    /// and let `tenantDateFromSpString` on the frontend swap for US.</summary>
    public string? DeliveryDate { get; set; }
    public string? ReadyTime { get; set; }
    public string? ToAddress { get; set; }
    public int Items { get; set; }

    // T.4: Sort + Run are true tri-state (0/1/2); the rest are binary.
    public byte SortScanned { get; set; }
    public byte RunScanned { get; set; }
    public byte PickScanned { get; set; }
    public byte InvalidPickScanned { get; set; }
    public byte TransferScanned { get; set; }
    public byte TransitScanned { get; set; }
}

/// <summary>
/// Routed-mode Scan Manager grid row. Sourced from RVW_stpScanJobsRouted.
/// Stage is fully-formatted human-readable server-side; React must NOT
/// synthesize its own. Legs is a JSON string parsed client-side.
/// </summary>
public class RoutedScanJobDto
{
    public int JobId { get; set; }
    public int BulkJobId { get; set; }
    public string? JobNumber { get; set; }
    public string? ClientCode { get; set; }
    public string? ToAddress { get; set; }
    public string? Suburb { get; set; }
    public string? CompanyName { get; set; }

    /// <summary>Fully-formatted human-readable status string
    /// (e.g. "LH1 - in transit", "Awaiting LHP pickup",
    /// "Item -3 short (LH1)"). Built server-side; DO NOT
    /// synthesize client-side.</summary>
    public string? Stage { get; set; }

    /// <summary>First non-completed leg identifier (LHP/LH1..LHn/DEL).
    /// Distinct from Stage.</summary>
    public string? CurrentLeg { get; set; }

    /// <summary>Item count from tucJobItems; drives the "N items"
    /// expandable badge.</summary>
    public int ItemCount { get; set; }

    /// <summary>Total scanned items across the shipment.</summary>
    public int ScannedItems { get; set; }
    public int ExpectedItems { get; set; }

    /// <summary>JSON string - React parses per-row to
    /// { Leg, LinehaulRunId, LinehaulRunName, ToDepot, State, PackedRole }
    /// array ordered LHP -> LH1..LHn -> DEL.</summary>
    public string? Legs { get; set; }

    /// <summary>Any leg has a pack-time short exception
    /// (ScanType 26 with RUN:NONE). Triggers red badge alert.</summary>
    public bool HasShort { get; set; }

    /// <summary>Items on the same leg have divergent states
    /// (some completed, others pending). Triggers Items-badge alert.</summary>
    public bool IsDivergent { get; set; }
}

/// <summary>
/// Scan Detail panel row (right column of Scan Manager). Class name
/// is intentionally BulkScanDetail (matches legacy VM at
/// ViewModels/ScanDetail.cs). Six extended context columns added
/// 2026-07-02 for Steve's Scan Detail panel Time/Scan/Location/By
/// layout.
/// </summary>
public class BulkScanDetailDto
{
    public int ScanId { get; set; }
    public DateTime? ScanDateTime { get; set; }
    public string? ScanDetail { get; set; }
    public string? Courier { get; set; }
    public bool IsNpAgent { get; set; }

    // 2026-07-02 extended context columns.
    public string? Leg { get; set; }
    public string? Location { get; set; }
    public string? Tote { get; set; }
    public string? Run { get; set; }

    /// <summary>JSON string - array of piece barcodes; React parses.
    /// </summary>
    public string? ItemLabels { get; set; }

    public string? Role { get; set; }
}

/// <summary>
/// Item-progression row inside a Routed-mode expanded shipment row.
/// Sourced from RVW_stpScanManagerItemProgress. React groups by
/// itemBarcode into itemProgressGrouped for the per-item leg-track
/// mini-display.
/// </summary>
public class RoutedItemProgressDto
{
    public int JobId { get; set; }
    public string? ItemBarcode { get; set; }
    public string? Leg { get; set; }
    public string? State { get; set; }
    public string? Tote { get; set; }
    public bool IsCurrent { get; set; }
    public DateTime? ScanTime { get; set; }
}

/// <summary>
/// Routed shipment full-detail drawer (fallback path). Returns 5
/// JSON-string columns that React must double-parse. Currently marked
/// dead code in scanControl.js comment on the frontend; kept for
/// possible re-use per Section Z decision.
/// </summary>
public class RoutedShipmentDetailDto
{
    public int RootJobId { get; set; }
    public string? JobNumber { get; set; }
    public string? ClientCode { get; set; }
    public string? ToAddress { get; set; }

    /// <summary>JSON string. Double-parse: each Tote row has an
    /// ActiveItems JSON string that itself needs JSON.parse to
    /// { ItemBarcode, AddedAt } array.</summary>
    public string? Totes { get; set; }

    /// <summary>JSON string. Category badges: MISSING (red) / OVER
    /// (orange) / WRONGRUN (purple).</summary>
    public string? Mismatches { get; set; }

    public string? Legs { get; set; }
    public string? Exceptions { get; set; }
    public string? OpenTasks { get; set; }
}
