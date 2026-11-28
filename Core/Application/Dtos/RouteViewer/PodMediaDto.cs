namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

/// <summary>
/// Cheetah R4 (2026-11-28): one POD photo / signature for the Detail
/// carousel, read by tucJob id across the job family (parent + child legs).
/// Data serialises as base64, as the bulk-job carousel payload does.
/// </summary>
public class PodMediaDto
{
    public int JobId { get; set; }
    public string? JobNumber { get; set; }
    /// <summary>"Delivery photo", "Signature" or "Pickup photo".</summary>
    public string Kind { get; set; } = "";
    public byte[] Data { get; set; } = [];
}
