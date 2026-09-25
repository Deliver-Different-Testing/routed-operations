// DTOs for Route Viewer label print + report endpoints. Full
// implementation is P14; P1 delivers the endpoint contracts so
// consuming UI phases can wire against real routes.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class LabelRequest
{
    public DateTime? BookDate { get; set; }
    public string? ClientIds { get; set; }
    public string? CourierIds { get; set; }
    public string? SpeedIds { get; set; }
    public string? RegionIds { get; set; }
    public string? BulkJobIds { get; set; }
    public string? RunName { get; set; }
    public int? SortMode { get; set; }
    public int? SortDir { get; set; }
    public int? DepotId { get; set; }
}

public class ReportRequest
{
    public DateTime? RunDate { get; set; }
    public DateTime? FromDate { get; set; }
    public DateTime? ToDate { get; set; }
    public string? ClientIds { get; set; }
    public string? Regions { get; set; }
    public string? Speeds { get; set; }
    /// <summary>Woop XLSX only: tucClient.ucclGroupID to filter on. Legacy hardcoded
    /// 16867 (NZ). US tenants pass their own group id; null falls back to legacy.</summary>
    public int? GroupId { get; set; }
    /// <summary>Linehaul CSV: fallback linehaul speed IDs when Speeds is empty.
    /// Legacy hardcoded 18 NZ ids. US callers pass their own.</summary>
    public string? LinehaulSpeedIds { get; set; }
    /// <summary>Linehaul CSV: exclusion filters. Legacy hardcodes ClientName
    /// != 'HelloFresh' and FromSuburb != 'Otahuhu'. Optional per-caller.</summary>
    public string? ExcludeClientName { get; set; }
    public string? ExcludeFromSuburb { get; set; }
}
