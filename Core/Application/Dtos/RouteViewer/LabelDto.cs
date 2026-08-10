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
}
