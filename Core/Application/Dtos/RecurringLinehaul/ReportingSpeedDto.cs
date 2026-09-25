namespace RoutedOperations.Core.Application.Dtos.RecurringLinehaul;

// Enriched speed shape used by the Linehaul edit modal's Speed dropdown +
// the Mapped Stops JobDetail modal's Speed picker. groupingName drives both
// the optgroup label and the SpeedChip colour rule.
public class ReportingSpeedDto
{
    public int Id { get; set; }
    public string ShortName { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int GroupingId { get; set; }
    public string? GroupingName { get; set; }
}

// Row summary for the Mapped Stops drill-down list.
public class BulkJobListItemDto
{
    public int Id { get; set; }
    public string JobNumber { get; set; } = string.Empty;
    public string? Pickup { get; set; }
    public string? Drop { get; set; }
    public int SpeedId { get; set; }
    public string SpeedShortName { get; set; } = string.Empty;
    public string SpeedName { get; set; } = string.Empty;
    public int? SpeedGroupingId { get; set; }
    public string? SpeedGroupingName { get; set; }
    public string? BookDate { get; set; }
    public string? BookTime { get; set; }
    public string? StatusName { get; set; }
}

// Full detail returned by GET /api/recurring-jobs/{jobId} + the response to
// PATCH /api/recurring-jobs/{jobId}/speed.
public class BulkJobDetailDto
{
    public int Id { get; set; }
    public string JobNumber { get; set; } = string.Empty;
    public string Customer { get; set; } = string.Empty;
    public string StatusName { get; set; } = string.Empty;
    public string PickupAddress { get; set; } = string.Empty;
    public string DropAddress { get; set; } = string.Empty;
    public string? BookDate { get; set; }
    public string? BookTime { get; set; }
    public string? LinehaulRunName { get; set; }
    public int SpeedId { get; set; }
    public string SpeedShortName { get; set; } = string.Empty;
    public string SpeedName { get; set; } = string.Empty;
    public int? SpeedGroupingId { get; set; }
    public string? SpeedGroupingName { get; set; }
    public bool SpeedEditable { get; set; }
    public string? Notes { get; set; }
}

public class BulkJobUpdateSpeedRequest
{
    public int SpeedId { get; set; }
}
