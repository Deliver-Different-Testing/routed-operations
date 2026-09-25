// Region roll-up row for the overview box. Sourced from
// RVW_stpRunOverview / RVW_stpLinehaulOverview. Feeds Home + CS +
// Linehaul + Scans overview boxes (same shape everywhere).
//
// Row click on the frontend sets pickDateService.regions = [this region]
// (single-region focus) and refreshes.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class RegionOverviewDto
{
    public int RegionId { get; set; }
    public string? Region { get; set; }

    public int Total { get; set; }
    public int SortScan { get; set; }
    public int RunScan { get; set; }
    public int PickedUp { get; set; }
    public int ToDo { get; set; }

    /// <summary>Percent for the progress bar width.</summary>
    public decimal Percent { get; set; }

    /// <summary>Legacy CSS class name that maps to bar colour ("green" /
    /// "orange" / "red"). React must map to new palette.</summary>
    public string? Class { get; set; }

    /// <summary>Linehaul variant surfaces Pallet count on the overview
    /// row (not present on the Home overview). Null when the SP does
    /// not populate.</summary>
    public string? Pallet { get; set; }

    /// <summary>Active flag for the "Active Regions Only" filter
    /// checkbox client-side.</summary>
    public bool Active { get; set; }
}
