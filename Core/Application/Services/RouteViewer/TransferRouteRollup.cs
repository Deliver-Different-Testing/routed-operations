// Pure rollup for RVW_stpTransferRouteForFamilies (#1004).
//
// The proc returns two result sets:
//   #1 one row per anchor job: AnchorJobID int, FamilyRoot int, FromRouteId int,
//      RowsUpdated int, Status nvarchar, BookingRootUcbkID int,
//      BookingRowsUpdated int, BookingStatus nvarchar
//   #2 one row per (FromRouteId, ZipPolygonId) touched by the zip move:
//      FromRouteId int, ZipPolygonId int, Zip varchar, InsertedToDestination bit,
//      DeletedFromSource bit (empty unless @AlsoTransferZipCodes = 1)
//
// Before this file the service mapped set #1 onto a class with
// { string FamilyRoot; bool Ok; int RowsUpdated }. There is no Ok column and
// FamilyRoot is an int, so EF threw after the proc had already written, and
// the user got a 500 for a transfer that had actually happened.
//
// Kept free of EF / ADO so it can be unit-tested without a SQL Server.
using RoutedOperations.Core.Application.Dtos.RouteViewer;

namespace RoutedOperations.Core.Application.Services.RouteViewer;

/// <summary>One row of result set #1, column-for-column with the proc.</summary>
public sealed class TransferFamilyRow
{
    public int AnchorJobID { get; set; }
    public int? FamilyRoot { get; set; }
    public int? FromRouteId { get; set; }
    public int RowsUpdated { get; set; }
    public string Status { get; set; } = "";
    public int? BookingRootUcbkID { get; set; }
    public int BookingRowsUpdated { get; set; }
    public string BookingStatus { get; set; } = "";
}

/// <summary>One row of result set #2 (zip move detail).</summary>
public sealed class TransferZipRow
{
    public int FromRouteId { get; set; }
    public int ZipPolygonId { get; set; }
    public string? Zip { get; set; }
    public bool InsertedToDestination { get; set; }
    public bool DeletedFromSource { get; set; }
}

/// <summary>Raised when the proc rejects the request with a RAISERROR
/// (SqlException number 50000), for example an inactive destination route.
/// The controller maps it to 400 with the proc's message.</summary>
public sealed class RouteTransferRejectedException(string message) : Exception(message);

public static class TransferRouteRollup
{
    /// <summary>A row counts as succeeded when the proc moved it (OK) or it
    /// was already on the destination route (NoChange). Every other status
    /// (NotFound, or any status the proc adds later) is a failure and is
    /// reported in Errors with the anchor job id.</summary>
    public static bool IsSuccess(string? status) =>
        string.Equals(status, "OK", StringComparison.OrdinalIgnoreCase)
        || string.Equals(status, "NoChange", StringComparison.OrdinalIgnoreCase);

    public static TransferRouteResult Build(
        IReadOnlyList<TransferFamilyRow> families,
        IReadOnlyList<TransferZipRow> zips,
        TransferRouteRequest request,
        string? newRouteName)
    {
        // Two anchors in the same family share one booking root, and the proc
        // repeats that root's row count on each anchor, so count each root once.
        var bookingRoots = families
            .Where(f => f.BookingRootUcbkID.HasValue)
            .GroupBy(f => f.BookingRootUcbkID!.Value)
            .ToList();

        var movedZips = zips.Where(z => z.InsertedToDestination || z.DeletedFromSource).ToList();

        return new TransferRouteResult
        {
            Succeeded = families.Count(f => IsSuccess(f.Status)),
            Failed = families.Count(f => !IsSuccess(f.Status)),
            RowsUpdated = families.Sum(f => f.RowsUpdated),
            BookingsAffected = bookingRoots.Count(g =>
                g.Any(f => string.Equals(f.BookingStatus, "OK", StringComparison.OrdinalIgnoreCase))),
            BookingRowsUpdated = bookingRoots.Sum(g => g.Max(f => f.BookingRowsUpdated)),
            ZipCodesMoved = movedZips
                .Select(z => (z.Zip ?? "").Trim())
                .Where(z => z.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count(),
            ZipMappingsInserted = zips.Count(z => z.InsertedToDestination),
            ZipMappingsDeleted = zips.Count(z => z.DeletedFromSource),
            ZipCodes = movedZips
                .Select(z => (z.Zip ?? "").Trim())
                .Where(z => z.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(z => z, StringComparer.OrdinalIgnoreCase)
                .ToList(),
            Families = families
                .Where(f => f.FamilyRoot.HasValue)
                .Select(f => f.FamilyRoot!.Value)
                .Distinct()
                .Select(id => id.ToString(System.Globalization.CultureInfo.InvariantCulture))
                .ToList(),
            Errors = families
                .Where(f => !IsSuccess(f.Status))
                .Select(f => $"Job {f.AnchorJobID}: {DescribeStatus(f.Status)}")
                .ToList(),
            NewRouteId = request.NewRouteId,
            NewRouteName = newRouteName,
            AlsoTransferredRecurringBooking = request.AlsoTransferRecurringBooking,
            AlsoTransferredZipCodes = request.AlsoTransferZipCodes,
        };
    }

    private static string DescribeStatus(string? status) => status switch
    {
        null or "" => "not moved (no status returned)",
        var s when string.Equals(s, "NotFound", StringComparison.OrdinalIgnoreCase) => "job not found",
        var s => $"not moved ({s})",
    };
}
