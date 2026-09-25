// Linehaul run-list row. Sourced from RVW_stpLineHaulRuns. Field-level
// shape from master Section 16.7 with the Loop-3 correction: Percent +
// Class are pre-computed load percentage + CSS class name; Pallet is a
// pre-formatted "N pallets" string (NOT numeric).
//
// TransitScan is a back-compat alias of ScannedItems kept in the payload
// until every consumer migrates to ScannedItems. Do NOT drop.
//
// MasterJobNumber (2026-07-01 Steve AC7) populated only when the run's
// booking is IsLinehaulMaster=1; renders as "Master: {{masterJobNumber}}"
// subtitle under the Run label on the linehaul runList row.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class LinehaulRunDto
{
    public int Id { get; set; }
    public string? Name { get; set; }

    /// <summary>2026-07-01 Steve AC7. Master job number surfaced under the
    /// Run label. NULL when tucJobBooking.IsLinehaulMaster != 1.</summary>
    public string? MasterJobNumber { get; set; }

    public string? FromDepot { get; set; }
    public string? ToDepot { get; set; }
    public int? ToDepotId { get; set; }

    public int Jobs { get; set; }

    /// <summary>Scanned-items count for the "Scans" column (rendered as
    /// "{scannedItems} of {expectedItems}"). 2026-07-01 addition.</summary>
    public int ScannedItems { get; set; }
    public int ExpectedItems { get; set; }

    /// <summary>Back-compat alias of ScannedItems. Keep in payload until
    /// all consumers migrate.</summary>
    public int TransitScan { get; set; }

    /// <summary>Pre-formatted pallet-count summary string (e.g. "3 pallets"
    /// or "0.5 pallet"). NOT numeric.</summary>
    public string? Pallet { get; set; }

    /// <summary>Pre-computed load percentage.</summary>
    public decimal? Percent { get; set; }

    /// <summary>Legacy CSS class name ("green" / "orange" / "red"). React
    /// must map to the new palette; do NOT emit hex codes here.</summary>
    public string? Class { get; set; }

    public int? CourierId { get; set; }
    public string? CourierName { get; set; }
    public string? CourierCode { get; set; }

    public int? AgentId { get; set; }
    public string? AgentName { get; set; }
    public bool IsNpAgent { get; set; }
}
