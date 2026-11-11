// TransferRouteRollup turns RVW_stpTransferRouteForFamilies' two result sets
// into TransferRouteResult (#1004). Pure, so no DB.
//
// Why these matter: before #1004 the service mapped set #1 onto a class with
// an `Ok` column the proc never returns, EF threw after the proc had written,
// and the operator got a 500 for a transfer that had happened. The rules
// pinned here are what the toast now reports.
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class TransferRouteRollupTests
{
    private static TransferRouteRequest Req(bool booking = false, bool zips = false) => new()
    {
        JobIds = new List<int> { 1 },
        NewRouteId = 15,
        AlsoTransferRecurringBooking = booking,
        AlsoTransferZipCodes = zips,
    };

    private static TransferFamilyRow Row(int anchor, string status, int rows = 1, int? root = null,
        int? bookingRoot = null, int bookingRows = 0, string bookingStatus = "NotRequested") => new()
    {
        AnchorJobID = anchor,
        FamilyRoot = root ?? anchor,
        FromRouteId = 5,
        RowsUpdated = rows,
        Status = status,
        BookingRootUcbkID = bookingRoot,
        BookingRowsUpdated = bookingRows,
        BookingStatus = bookingStatus,
    };

    [Theory]
    [InlineData("OK", true)]
    [InlineData("NoChange", true)]
    [InlineData("ok", true)]
    [InlineData("NotFound", false)]
    [InlineData("LinehaulLeg", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsSuccess_OnlyOkAndNoChange(string? status, bool expected)
    {
        Assert.Equal(expected, TransferRouteRollup.IsSuccess(status));
    }

    [Fact]
    public void Build_CountsNoChangeAsSucceeded_AndReportsFailuresWithTheAnchor()
    {
        var families = new[]
        {
            Row(20857, "OK", rows: 1),
            Row(20866, "NoChange", rows: 0),
            Row(99999, "NotFound", rows: 0, root: null),
        };
        families[2].FamilyRoot = null;

        var r = TransferRouteRollup.Build(families, Array.Empty<TransferZipRow>(), Req(), "Burbank to Lab");

        Assert.Equal(2, r.Succeeded);
        Assert.Equal(1, r.Failed);
        Assert.Equal(1, r.RowsUpdated);
        Assert.Equal(new[] { "Job 99999: job not found" }, r.Errors);
        Assert.Equal(new[] { "20857", "20866" }, r.Families);
        Assert.Equal(15, r.NewRouteId);
        Assert.Equal("Burbank to Lab", r.NewRouteName);
    }

    [Fact]
    public void Build_UnknownStatus_IsAFailureNamingTheStatus()
    {
        var r = TransferRouteRollup.Build(new[] { Row(1, "LinehaulLeg", rows: 0) },
            Array.Empty<TransferZipRow>(), Req(), null);

        Assert.Equal(0, r.Succeeded);
        Assert.Equal(1, r.Failed);
        Assert.Equal("Job 1: not moved (LinehaulLeg)", Assert.Single(r.Errors));
    }

    [Fact]
    public void Build_TwoAnchorsSharingABookingRoot_CountTheBookingOnce()
    {
        // The proc repeats the root's BookingRowsUpdated on every anchor of
        // that family; summing it would double the number shown.
        var families = new[]
        {
            Row(1, "OK", root: 10, bookingRoot: 500, bookingRows: 4, bookingStatus: "OK"),
            Row(2, "OK", root: 10, bookingRoot: 500, bookingRows: 4, bookingStatus: "OK"),
            Row(3, "OK", root: 30, bookingRoot: 600, bookingRows: 0, bookingStatus: "NoChange"),
        };

        var r = TransferRouteRollup.Build(families, Array.Empty<TransferZipRow>(), Req(booking: true), null);

        Assert.Equal(1, r.BookingsAffected);
        Assert.Equal(4, r.BookingRowsUpdated);
        Assert.Equal(new[] { "10", "30" }, r.Families);
        Assert.True(r.AlsoTransferredRecurringBooking);
    }

    [Fact]
    public void Build_ZipDetail_CountsDistinctMovedZipsAndBothSides()
    {
        var zips = new[]
        {
            new TransferZipRow { FromRouteId = 5, ZipPolygonId = 1, Zip = "92656", InsertedToDestination = true, DeletedFromSource = true },
            new TransferZipRow { FromRouteId = 7, ZipPolygonId = 2, Zip = " 92656 ", InsertedToDestination = false, DeletedFromSource = true },
            new TransferZipRow { FromRouteId = 5, ZipPolygonId = 3, Zip = "89501", InsertedToDestination = true, DeletedFromSource = false },
            new TransferZipRow { FromRouteId = 5, ZipPolygonId = 4, Zip = "89502", InsertedToDestination = false, DeletedFromSource = false },
        };

        var r = TransferRouteRollup.Build(new[] { Row(1, "OK") }, zips, Req(zips: true), null);

        Assert.Equal(2, r.ZipCodesMoved);
        Assert.Equal(new[] { "89501", "92656" }, r.ZipCodes);
        Assert.Equal(2, r.ZipMappingsInserted);
        Assert.Equal(2, r.ZipMappingsDeleted);
    }

    [Fact]
    public void Build_NoRows_IsAllZeroNotAnError()
    {
        var r = TransferRouteRollup.Build(Array.Empty<TransferFamilyRow>(), Array.Empty<TransferZipRow>(), Req(), null);

        Assert.Equal(0, r.Succeeded);
        Assert.Equal(0, r.Failed);
        Assert.Empty(r.Errors);
        Assert.Empty(r.Families);
    }
}
