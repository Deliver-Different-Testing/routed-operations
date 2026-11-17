// UC #881. Staff Import reads a row's Book Date in the tenant's order, not the
// host culture's. The same cell, 12/11/2026, is 12 November to an NZ office and
// 11 December to a US one. Before this the row went through DateTime.TryParse,
// so the answer depended on how the server happened to be set up.
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;

namespace RoutedOperations.Tests.Services.BulkImport;

public partial class BulkTruckRoutingTests
{
    private static Dictionary<string, object> StaffDated(string number, string bookDate, string? bookTime = null)
    {
        var row = StaffRow(number, P2PSpeed);
        row["BookDate"] = bookDate;
        if (bookTime != null) row["BookTime"] = bookTime;
        return row;
    }

    [Fact]
    public async Task Staff_import_reads_12_11_2026_as_12_November_on_an_NZ_tenant()
    {
        var rig = NewRig(tenant: "NZ");

        await rig.Svc.StaffImport(ContactId, new StaffImportRequest { Jobs = new[] { StaffDated("P1", "12/11/2026", "08:30") } });

        var call = Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"));
        Assert.Equal(new DateTime(2026, 11, 12), call["bookDate"]);
        Assert.Equal(new TimeSpan(8, 30, 0), ((DateTime?)call["bookTime"])!.Value.TimeOfDay);
    }

    [Fact]
    public async Task Staff_import_reads_12_11_2026_as_11_December_on_a_US_tenant()
    {
        var rig = NewRig(tenant: "US");

        await rig.Svc.StaffImport(ContactId, new StaffImportRequest { Jobs = new[] { StaffDated("P1", "12/11/2026", "2:00 pm") } });

        var call = Assert.Single(rig.CallsTo("DD_stpJob_InsertExceleratorAsync"));
        Assert.Equal(new DateTime(2026, 12, 11, 14, 0, 0), call["time"]);
    }

    [Fact]
    public async Task Staff_import_refuses_a_book_date_it_cannot_read_and_books_the_rest()
    {
        var rig = NewRig(tenant: "NZ");

        var resp = await rig.Svc.StaffImport(ContactId, new StaffImportRequest
        {
            Jobs = new[] { StaffDated("BAD", "31/02/2026"), StaffDated("BADT", "12/11/2026", "noon"), StaffDated("OK", "12/11/2026") },
        });

        Assert.Equal(new[] { "Book date not recognised.", "Book time not recognised." }, resp.FailedJobs.Select(f => f.Error));
        Assert.Equal("OK", Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"))["jobNumber"]);
    }
}
