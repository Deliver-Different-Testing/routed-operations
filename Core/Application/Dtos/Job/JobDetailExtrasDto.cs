namespace RoutedOperations.Core.Application.Dtos.Job;

/// <summary>
/// The "heavy" fields that used to ride on <see cref="BulkJobDto"/> in every
/// /api/jobs list response, now fetched lazily via GET /api/jobs/{id}/detail
/// only when the operator selects a job to open the JobDetail modal.
///
/// Dropping these from the list projection cut the /api/jobs payload
/// significantly for busy days (500+ jobs, ~50-100 bytes each = 25-50 KB
/// removed pre-compression). Notes can be several hundred chars per row
/// making the win bigger on tenants with heavy note usage.
/// </summary>
public class JobDetailExtrasDto
{
    public int BulkJobId { get; set; }
    public string? Notes { get; set; }
    public string? TrackingEmail { get; set; }
    public string? TrackingMobile { get; set; }
    public string? ProofOfDeliveryEmail { get; set; }
    public string? ProofOfDeliveryMobile { get; set; }
}
