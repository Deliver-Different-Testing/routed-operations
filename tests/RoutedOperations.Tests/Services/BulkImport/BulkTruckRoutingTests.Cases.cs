// UC #881 cases from the independent review.
// 1. Parser parity table: the SAME inputs and expected outputs as
//    wwwroot/app/react/components/bulk-import/bulkTruck881.cases.test.tsx, so a
//    frontend/server disagreement shows up as a red row on one side.
// 2. RowBookDate window: today with a passed time, date-only and time-only rows
//    filled from a passed default, and the 30-day edge.
// 3. Spec test 2: a blank Speed cell takes the defaults-step speed (server half).
// 4. An NZ P2P file that carries a Speed column keeps the P2P size rules it had
//    without one (no truck-only caps).
using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Services.BulkImport;

public partial class BulkTruckRoutingTests
{
    // ---- 1. parser parity table ------------------------------------------------

    [Theory]
    [InlineData("13/11/2026", "2026-11-13", "2026-11-13")]
    [InlineData("12/11/2026", "2026-11-12", "2026-12-11")]
    [InlineData("11/13/2026", "2026-11-13", "2026-11-13")]
    [InlineData("1/2/26", "2026-02-01", "2026-01-02")]
    [InlineData("13/11/26", "2026-11-13", "2026-11-13")]
    [InlineData("13-11-2026", "2026-11-13", "2026-11-13")]
    [InlineData("  13/11/2026  ", "2026-11-13", "2026-11-13")]
    [InlineData("13/11/2026 0:00", "2026-11-13", "2026-11-13")]
    [InlineData("13/11/2026 8:30 AM", "2026-11-13", "2026-11-13")]
    [InlineData("2026-11-13", "2026-11-13", "2026-11-13")]
    [InlineData("2026-11-13T00:00:00", "2026-11-13", "2026-11-13")]
    [InlineData("2026-11-13 08:30:00", "2026-11-13", "2026-11-13")]
    [InlineData("29/02/2028", "2028-02-29", "2028-02-29")]
    [InlineData("31/02/2026", null, null)]
    [InlineData("2026-02-29", null, null)]
    [InlineData("13/13/2026", null, null)]
    [InlineData("0/11/2026", null, null)]
    [InlineData("46339", null, null)]
    [InlineData("1899-12-31T08:30:00", null, null)]
    [InlineData("13.11.2026", null, null)]
    [InlineData("2026/11/13", null, null)]
    [InlineData("13/11/126", null, null)]
    // Month names (review finding 5): English, either order, so NZ and US agree.
    [InlineData("Nov 13 2026", "2026-11-13", "2026-11-13")]
    [InlineData("13 Nov 2026", "2026-11-13", "2026-11-13")]
    [InlineData("13-Nov-2026", "2026-11-13", "2026-11-13")]
    [InlineData("13-Nov-26", "2026-11-13", "2026-11-13")]
    [InlineData("13 November 2026", "2026-11-13", "2026-11-13")]
    [InlineData("13 nov 2026 08:30", "2026-11-13", "2026-11-13")]
    [InlineData("1 Sept 2026", "2026-09-01", "2026-09-01")]
    [InlineData("Nov 13, 2026", "2026-11-13", "2026-11-13")]
    [InlineData("November 13, 2026 8:30 AM", "2026-11-13", "2026-11-13")]
    [InlineData("Dec 1, 2026 14:00", "2026-12-01", "2026-12-01")]
    [InlineData("29 Feb 2028", "2028-02-29", "2028-02-29")]
    [InlineData("31 Feb 2026", null, null)]
    [InlineData("13 Foo 2026", null, null)]
    [InlineData("Nov 13, 26", null, null)]
    [InlineData("13 Nov", null, null)]
    public void parity_date(string input, string? nz, string? us)
    {
        Assert.Equal(nz, BulkImportDateParser.ParseDate(input, false)?.ToString("yyyy-MM-dd"));
        Assert.Equal(us, BulkImportDateParser.ParseDate(input, true)?.ToString("yyyy-MM-dd"));
    }

    [Theory]
    [InlineData("08:30", "08:30")]
    [InlineData("8:30", "08:30")]
    [InlineData(" 08:30 ", "08:30")]
    [InlineData("14:00:59", "14:00")]
    [InlineData("8:30 am", "08:30")]
    [InlineData("8:30 PM", "20:30")]
    [InlineData("8:30pm", "20:30")]
    [InlineData("12:00 am", "00:00")]
    [InlineData("12:15 pm", "12:15")]
    [InlineData("1899-12-31T14:00:00", "14:00")]
    [InlineData("1899-12-30T14:00:00", "14:00")]
    [InlineData("2026-11-13T08:30:00Z", "08:30")]
    [InlineData("2026-11-13T08:30:00+13:00", "08:30")]
    [InlineData("24:00", null)]
    [InlineData("13:00 pm", null)]
    [InlineData("0.3541666", null)]
    [InlineData("0830", null)]
    [InlineData("8.30", null)]
    [InlineData("noon", null)]
    public void parity_time(string input, string? expected)
    {
        Assert.Equal(expected, BulkImportDateParser.ParseTime(input)?.ToString(@"hh\:mm"));
    }

    // ---- 2. RowBookDate window ------------------------------------------------

    private static readonly DateTime CaseNow = new(2026, 11, 17, 10, 0, 0);
    private static readonly DateTime CaseDefault = new(2026, 11, 18, 9, 30, 0);

    [Fact]
    public void a_row_dated_today_whose_time_has_passed_is_refused()
    {
        var r = RowBookDate.Resolve("17/11/2026", "09:59", CaseDefault, false, CaseNow);
        Assert.Equal(RowBookDate.InThePast, r.Error);
    }

    [Fact]
    public void a_row_dated_today_with_a_later_time_books()
    {
        var r = RowBookDate.Resolve("17/11/2026", "10:01", CaseDefault, false, CaseNow);
        Assert.Null(r.Error);
        Assert.Equal(new DateTime(2026, 11, 17, 10, 1, 0), r.BookDateTime);
    }

    [Fact]
    public void a_date_only_row_for_today_takes_the_default_time_and_is_refused_once_it_has_passed()
    {
        var r = RowBookDate.Resolve("17/11/2026", null, CaseDefault, false, CaseNow);
        Assert.Equal(RowBookDate.InThePast, r.Error);
    }

    [Fact]
    public void a_time_only_row_takes_the_default_date()
    {
        var r = RowBookDate.Resolve(null, "07:00", CaseDefault, false, CaseNow);
        Assert.Equal(new DateTime(2026, 11, 18, 7, 0, 0), r.BookDateTime);
        var past = RowBookDate.Resolve(null, "07:00", CaseNow.Date, false, CaseNow);
        Assert.Equal(RowBookDate.InThePast, past.Error);
    }

    [Fact]
    public void a_blank_row_is_left_to_the_batch_check()
    {
        var r = RowBookDate.Resolve("  ", "", CaseNow.AddDays(-1), false, CaseNow);
        Assert.Null(r.BookDateTime);
        Assert.Null(r.Error);
    }

    [Fact]
    public void the_30_day_edge_matches_the_validator()
    {
        Assert.Null(RowBookDate.Resolve("16/12/2026", "23:59", CaseDefault, false, CaseNow).Error);
        Assert.Equal(RowBookDate.TooFarAhead, RowBookDate.Resolve("17/12/2026", "00:00", CaseDefault, false, CaseNow).Error);
    }

    // ---- 3. spec test 2, server half ------------------------------------------

    [Fact]
    public async Task truck_file_a_blank_speed_row_takes_the_batch_speed_and_the_other_keeps_its_own()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(Teco, Row("T1", "Truck Standard"), Row("T2")));

        Assert.True(resp.Success);
        Assert.Equal(TruckStandard, rig.Inserted.Single(r => r.ucjbNumber == "T1").ucjbSpeed);
        Assert.Equal(Teco, rig.Inserted.Single(r => r.ucjbNumber == "T2").ucjbSpeed);
    }

    [Fact]
    public async Task p2p_file_a_blank_speed_row_takes_the_batch_speed_and_the_other_keeps_its_own()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("P1", "Economy"), Row("P2")));

        Assert.True(resp.Success);
        var calls = rig.CallsTo("INT_stpJob_BulkInsertAsync");
        Assert.Equal(2, calls.Count);
        Assert.Equal(P2PEconomy, calls.Single(c => (string?)c["jobNumber"] == "P1")["speed"]);
        Assert.Equal(P2PSpeed, calls.Single(c => (string?)c["jobNumber"] == "P2")["speed"]);
    }

    // ---- 4. NZ P2P files with a Speed column keep the P2P size rules ----------

    [Fact]
    public async Task p2p_row_over_the_truck_dimension_cap_books_the_same_with_or_without_a_speed_column()
    {
        // Same oversize P2P row twice. Without a Speed cell anywhere it books as it
        // did before #881; with "Standard" in the Speed column it must book the same
        // way, because the validator's caps are the only ones a pure P2P file has.
        var plain = NewRig();
        var oversize = Row("P1"); oversize.Length = 300;
        await plain.Svc.Import(ContactId, OnDemand(P2PSpeed, oversize));
        Assert.Equal(1, plain.P2PCalls);

        var withSpeed = NewRig();
        var named = Row("P1", "Standard"); named.Length = 300;
        var resp = await withSpeed.Svc.Import(ContactId, OnDemand(P2PSpeed, named));
        Assert.Equal(1, withSpeed.P2PCalls);
        Assert.DoesNotContain(resp.Jobs ?? [], j => !string.IsNullOrEmpty(j.ErrorMessage));
    }
}
