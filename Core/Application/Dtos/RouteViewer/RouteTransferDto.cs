// DTOs for the two-step Transfer Route dialog (Section 13.2).
// Step 1 (pick): GET /api/runviewer/routes/active for the dropdown +
// current-route badge.
// Step 2 (preview): GET /api/runviewer/jobs/transfer-preview?ids=CSV
// for the confirm-step banner + row-table.
// Step 3 (submit): POST /api/runviewer/jobs/transfer-route with the
// jobIds + newRouteId + 2 opt-in flags.

namespace RoutedOperations.Core.Application.Dtos.RouteViewer;

public class RouteTransferContextResponse
{
    /// <summary>Route id the family currently sits on (badge display).
    /// Null if the anchor job has no route.</summary>
    public int? CurrentRouteId { get; set; }
    public string? CurrentRouteName { get; set; }

    public List<RouteOptionDto> Routes { get; set; } = new();
}

public class RouteOptionDto
{
    public int Id { get; set; }
    public string? Name { get; set; }
    public string? Area { get; set; }
}

public class TransferPreviewResponse
{
    public List<TransferPreviewRow> Jobs { get; set; } = new();
}

public class TransferPreviewRow
{
    public int JobId { get; set; }
    public string? JobNumber { get; set; }
    public string? FromAddress { get; set; }
    public int? CurrentRouteId { get; set; }
    public string? CurrentRouteName { get; set; }
}

public class TransferRouteRequest
{
    public List<int> JobIds { get; set; } = new();
    public int NewRouteId { get; set; }

    /// <summary>Cascade to tucJobBooking - re-stamps RouteId on the
    /// parent template + every child leg template.</summary>
    public bool AlsoTransferRecurringBooking { get; set; }

    /// <summary>Also move the RouteZipcodes mapping. Second opt-in.</summary>
    public bool AlsoTransferZipCodes { get; set; }
}

public class TransferRouteResult
{
    public int Succeeded { get; set; }
    public int Failed { get; set; }
    public int RowsUpdated { get; set; }
    public int BookingsAffected { get; set; }
    public int BookingRowsUpdated { get; set; }
    public int ZipCodesMoved { get; set; }
    public int ZipMappingsInserted { get; set; }
    public int ZipMappingsDeleted { get; set; }
    public List<string> ZipCodes { get; set; } = new();
    public List<string> Families { get; set; } = new();
    public List<string> Errors { get; set; } = new();

    public int? NewRouteId { get; set; }
    public string? NewRouteName { get; set; }
    public bool AlsoTransferredRecurringBooking { get; set; }
    public bool AlsoTransferredZipCodes { get; set; }
}
