// UC #881. The truck preview refuses a row whose own Book Date is past, the
// same as /import, and shows the reason so the operator sees it before booking.
namespace RoutedOperations.Tests.Services.BulkImport;

public partial class BulkTruckPreviewTests
{
    [Fact]
    public async Task The_preview_shows_a_row_dated_in_the_past_as_refused()
    {
        var rig = NewRig();
        var today = DateTime.UtcNow.Date;
        var old = Row("OLD", "TECO");
        old.BookDate = today.AddDays(-1).ToString("dd/MM/yyyy");
        old.BookTime = "08:30";
        var ok = Row("T1", "TECO");
        ok.BookDate = today.AddDays(1).ToString("dd/MM/yyyy");
        ok.BookTime = "08:30";

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(P2PSpeed, old, ok));

        NothingWasWritten(rig);
        var refused = preview.Rows.Single(r => r.JobNumber == "OLD");
        Assert.False(refused.WouldImport);
        Assert.Equal("Book date is in the past.", refused.Reason);
        Assert.True(preview.Rows.Single(r => r.JobNumber == "T1").WouldImport);
    }
}
