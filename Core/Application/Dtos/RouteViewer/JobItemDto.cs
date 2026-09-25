// Per-item barcode row for the multibox expand path + Scan Manager
// bulk-mode grandchild rows. Sourced from RVW_stpJobItems.
//
// CONTRACT (T.4 correction): scan flags on BulkJobItem are BOOL (per-
// item, binary). The parent BulkJob DTO uses byte tri-state for the
// same 6 fields. Semantic split is deliberate.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class JobItemDto
{
    public int BulkJobItemId { get; set; }
    public int BulkJobId { get; set; }
    public string? Barcode { get; set; }
    public string? ItemName { get; set; }

    public decimal? Weight { get; set; }
    public decimal? Length { get; set; }
    public decimal? Height { get; set; }
    public decimal? Depth { get; set; }

    public bool SortScanned { get; set; }
    public bool RunScanned { get; set; }
    public bool PickScanned { get; set; }
    public bool InvalidPickScanned { get; set; }
    public bool TransferScanned { get; set; }
    public bool TransitScanned { get; set; }
}
