namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class LinehaulRunListRequest
{
    public DateTime? RunDate { get; set; }
    public int? ClientId { get; set; }
    public bool ClientInternal { get; set; }
    public bool MultipleClients { get; set; }
    public string? ClientIds { get; set; }
    public string? FromRegionIds { get; set; }
    public string? RegionIds { get; set; }
    public string? SpeedIds { get; set; }
}

public class RegionOverviewRequest
{
    public DateTime? RunDate { get; set; }
    public string? ClientIds { get; set; }
    public string? SpeedIds { get; set; }

    /// <summary>Linehaul overview variant adds From/To region filters
    /// (unused by Home overview).</summary>
    public string? FromRegionIds { get; set; }
    public string? RegionIds { get; set; }
}
