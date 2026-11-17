// UC #881. The customer's file had two rows for different days: 13/11 08:30 and
// 12/11 14:00. Before this the server never read a row's Book Date, so both
// booked on the defaults-step date. Now each on-demand row (truck or P2P) books
// on its own date and time, and the defaults-step value only fills blank rows.
// There is no clock seam, so the dates are relative to the real now (rig tenant
// zone is UTC); her 12/13 Nov are already past on 17 Nov 2026.
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;

namespace RoutedOperations.Tests.Services.BulkImport;

public partial class BulkTruckRoutingTests
{
    private static string Nz(DateTime d) => d.ToString("dd/MM/yyyy");

    private static BulkImportJobCreateDto Dated(BulkImportJobCreateDto row, DateTime? date, string? time)
    {
        row.BookDate = date.HasValue ? Nz(date.Value) : null;
        row.BookTime = time;
        return row;
    }

    [Fact]
    public async Task Each_truck_row_books_on_its_own_date_and_time()
    {
        var rig = NewRig();
        var today = DateTime.UtcNow.Date;

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed,
            Dated(Row("T1", "TECO"), today.AddDays(2), "08:30"),
            Dated(Row("T2", "TECO"), today.AddDays(1), "14:00")));

        Assert.True(resp.Success);
        var t1 = rig.Inserted.Single(r => r.ucjbNumber == "T1");
        var t2 = rig.Inserted.Single(r => r.ucjbNumber == "T2");
        Assert.Equal(today.AddDays(2), t1.ucjbDate);
        Assert.Equal(new TimeSpan(8, 30, 0), t1.ucjbTime.TimeOfDay);
        Assert.Equal(today.AddDays(1), t2.ucjbDate);
        Assert.Equal(new TimeSpan(14, 0, 0), t2.ucjbTime.TimeOfDay);
    }

    [Fact]
    public async Task A_p2p_row_books_on_its_own_date_and_time()
    {
        var rig = NewRig();
        var today = DateTime.UtcNow.Date;

        await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Dated(Row("P1", "Standard"), today.AddDays(3), "2:00 pm")));

        var call = Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"));
        Assert.Equal(today.AddDays(3), call["bookDate"]);
        Assert.Equal(new TimeSpan(14, 0, 0), ((DateTime?)call["bookTime"])!.Value.TimeOfDay);
    }

    [Fact]
    public async Task A_blank_row_still_books_on_the_defaults_step_value()
    {
        var rig = NewRig();
        var today = DateTime.UtcNow.Date;

        await rig.Svc.Import(ContactId, OnDemand(P2PSpeed,
            Dated(Row("T1", "TECO"), today.AddDays(2), "08:30"),
            Row("T2", "TECO")));

        var t2 = rig.Inserted.Single(r => r.ucjbNumber == "T2");
        Assert.Equal(new DateTime(2031, 3, 4), t2.ucjbDate); // the request's BookDate
        Assert.Equal(new TimeSpan(9, 30, 0), t2.ucjbTime.TimeOfDay);
    }

    [Fact]
    public async Task A_row_dated_yesterday_is_refused_and_the_others_book()
    {
        var rig = NewRig();
        var today = DateTime.UtcNow.Date;

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed,
            Dated(Row("OLD", "TECO"), today.AddDays(-1), "08:30"),
            Dated(Row("T1", "TECO"), today.AddDays(1), "08:30"),
            Dated(Row("P1", "Standard"), today.AddDays(1), "09:00")));

        Assert.True(resp.Success);
        var refused = Assert.Single(resp.Jobs);
        Assert.Equal("OLD", refused.JobNumber);
        Assert.Equal("Book date is in the past.", refused.ErrorMessage);
        Assert.True(refused.TruckRejected);
        Assert.Equal("T1", Assert.Single(rig.Inserted).ucjbNumber);
        Assert.Equal("P1", Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"))["jobNumber"]);
    }

    [Fact]
    public async Task A_past_defaults_step_value_does_not_stop_a_file_whose_rows_all_have_dates()
    {
        // The batch check guards the rows that would use the batch value. When
        // every row brings its own date and time, no row uses it.
        var rig = NewRig();
        var today = DateTime.UtcNow.Date;
        var req = OnDemand(P2PSpeed, Dated(Row("T1", "TECO"), today.AddDays(1), "08:30"));
        req.BookDate = today.AddDays(-1);

        var resp = await rig.Svc.Import(ContactId, req);

        Assert.True(resp.Success);
        Assert.Single(rig.Inserted);
    }
}
