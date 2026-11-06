// The client reference check on Staff Import (NZ and US) and US New Import. A refused
// row must never reach the proc or use a job number, and must not stop the other rows.
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Services.BulkImport;

public partial class BulkP2PJobPinTests
{
    private const string RefusedA = "Require \"Reference A\" - \"cat\"";

    private static IBulkTruckPreflight ReferenceFacts(bool aMandatory = true, bool aList = false, params string[] listA)
    {
        var preflight = Substitute.For<IBulkTruckPreflight>();
        preflight.LoadClientsAsync(default!).ReturnsForAnyArgs(call => Task.FromResult<IReadOnlyDictionary<int, TruckClientFacts>>(
            call.Arg<IReadOnlyCollection<int>>().ToDictionary(c => c, c => new TruckClientFacts(c, "ACME", null, false, aMandatory, aMandatory ? "cat" : null, false, null, aList))));
        preflight.ReferenceListsAsync(default!).ReturnsForAnyArgs(call => Task.FromResult<IReadOnlyDictionary<int, ReferenceListResult>>(
            call.Arg<IReadOnlyList<ReferenceCheckRow>>().ToDictionary(r => r.RowNo, r => new ReferenceListResult(listA.Contains(r.ReferenceA), true))));
        return preflight;
    }

    private static Dictionary<string, object> StaffRow(string jobNumber, params (string Column, object Value)[] extra)
    {
        var row = new Dictionary<string, object>
        {
            { "ClientID", ClientId }, { "JobNumber", jobNumber }, { "Speed", Speed }, { "Qty", 1 }, { "Weight", 5 },
            { "FromAddress", "1 From St" }, { "FromSuburb", "Otahuhu" }, { "ToAddress", "2 To St" }, { "ToSuburb", "Albany" },
        };
        foreach (var (column, value) in extra) row[column] = value;
        return row;
    }

    private static string StaffProc(string country) => country == "NZ" ? "INT_stpJob_BulkInsertAsync" : "DD_stpJob_InsertExceleratorAsync";

    private static string BookedNumber(Dictionary<string, object?> call) => (string)call["jobNumber"]!;

    private static object? BookedReferenceA(string country, Dictionary<string, object?> call) =>
        country == "NZ" ? call["clientRefa"] : call["referenceA"];

    [Theory]
    [InlineData("NZ")]
    [InlineData("US")]
    public async Task Staff_refused_row_never_reaches_the_proc_and_the_rest_still_book(string country)
    {
        var rig = NewRig(country, preflight: ReferenceFacts());
        var request = new StaffImportRequest { Jobs = new[] { StaffRow("S1"), StaffRow("S2", ("ClientRefA", "PO1")) } };

        var resp = await rig.Svc.StaffImport(ContactId, request);

        var failed = Assert.Single(resp.FailedJobs);
        Assert.Equal(1, failed.RowNumber);
        Assert.Equal("S1", failed.JobNumber);
        Assert.Equal(RefusedA, failed.Error);
        Assert.Equal(1, resp.SuccessCount);
        Assert.True(resp.Success);
        var booked = Assert.Single(CallsTo(rig.Procs, StaffProc(country)));
        Assert.Equal("S2", BookedNumber(booked));
        Assert.Equal("PO1", BookedReferenceA(country, booked));
    }

    [Theory]
    [InlineData("NZ", "")]
    [InlineData("NZ", "AUTOGENERATE")]
    [InlineData("US", "")]
    [InlineData("US", "AUTOGENERATE")]
    public async Task Staff_refused_row_uses_no_job_number(string country, string jobNumber)
    {
        // sp_AssignJobNumbers throws under EF InMemory (DespatchContextTests), so a
        // call to it would replace the refusal below with a different error.
        var rig = NewRig(country, preflight: ReferenceFacts());

        var resp = await rig.Svc.StaffImport(ContactId, new StaffImportRequest { Jobs = new[] { StaffRow(jobNumber) } });

        Assert.Equal(RefusedA, Assert.Single(resp.FailedJobs).Error);
        Assert.False(resp.Success);
        Assert.Empty(CallsTo(rig.Procs, StaffProc(country)));
    }

    [Theory]
    [InlineData("NZ", "ClientRefA")]
    [InlineData("NZ", "Client Ref A")]
    [InlineData("NZ", "Ref A")]
    [InlineData("NZ", "Reference A")]
    [InlineData("NZ", "reference a")]
    [InlineData("US", "REF A")]
    public async Task Staff_reads_the_reference_under_any_accepted_header(string country, string header)
    {
        var rig = NewRig(country, preflight: ReferenceFacts());

        var resp = await rig.Svc.StaffImport(ContactId, new StaffImportRequest { Jobs = new[] { StaffRow("S1", (header, "PO1")) } });

        Assert.Empty(resp.FailedJobs);
        Assert.Equal("PO1", BookedReferenceA(country, Assert.Single(CallsTo(rig.Procs, StaffProc(country)))));
    }

    [Fact]
    public async Task Staff_a_blank_column_does_not_hide_a_filled_alias()
    {
        var rig = NewRig("NZ", preflight: ReferenceFacts());

        var resp = await rig.Svc.StaffImport(ContactId, new StaffImportRequest { Jobs = new[] { StaffRow("S1", ("ClientRefA", ""), ("Ref A", "PO1")) } });

        Assert.Empty(resp.FailedJobs);
        Assert.Equal("PO1", Assert.Single(CallsTo(rig.Procs, "INT_stpJob_BulkInsertAsync"))["clientRefa"]);
    }

    [Theory]
    [InlineData("NZ")]
    [InlineData("US")]
    public async Task Staff_define_list_refuses_a_value_outside_it_and_a_blank_on_an_optional_reference(string country)
    {
        var rig = NewRig(country, preflight: ReferenceFacts(aMandatory: false, aList: true, listA: "GOOD"));
        var request = new StaffImportRequest { Jobs = new[] { StaffRow("S1", ("Ref A", "NOPE")), StaffRow("S2"), StaffRow("S3", ("Ref A", "GOOD")) } };

        var resp = await rig.Svc.StaffImport(ContactId, request);

        Assert.Equal(new[] { "\"Reference A\" - \"NOPE\" not in defined list.", "\"Reference A\" - \"\" not in defined list." }, resp.FailedJobs.Select(f => f.Error));
        Assert.Equal("S3", BookedNumber(Assert.Single(CallsTo(rig.Procs, StaffProc(country)))));
    }

    [Fact]
    public async Task Staff_loads_the_client_flags_once_for_a_file_of_the_same_client()
    {
        var preflight = ReferenceFacts();
        var rig = NewRig("NZ", preflight: preflight);

        await rig.Svc.StaffImport(ContactId, new StaffImportRequest { Jobs = new[] { StaffRow("S1", ("Ref A", "A")), StaffRow("S2", ("Ref A", "B")) } });

        await preflight.ReceivedWithAnyArgs(1).LoadClientsAsync(default!);
        await preflight.DidNotReceiveWithAnyArgs().ReferenceListsAsync(default!);
    }

    [Fact]
    public async Task Us_wizard_refused_row_never_reaches_the_proc_and_the_rest_still_book()
    {
        var rig = NewRig("US", preflight: ReferenceFacts());
        var request = UsRequest();
        var good = request.Jobs.Single();
        good.ClientRefA = "PO1";
        good.Notes = null;
        var bad = new BulkImportJobCreateDto { JobNumber = "US2", FromContact = "Sender", ToZipCode = "73301" };
        request.Jobs = new[] { bad, good };

        var resp = await rig.Svc.Import(ContactId, request);

        Assert.True(resp.Success);
        Assert.Equal("US1", BookedNumber(Assert.Single(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"))));
        var refused = Assert.Single(resp.Jobs);
        Assert.Equal("US2", refused.JobNumber);
        Assert.Equal(RefusedA, refused.ErrorMessage);
        // Anything without this flag is offered to the operator as a km-rated row.
        Assert.True(refused.TruckRejected);
    }

    [Fact]
    public async Task Us_wizard_with_every_row_refused_lists_them_rather_than_saying_no_jobs()
    {
        var rig = NewRig("US", preflight: ReferenceFacts());

        var resp = await rig.Svc.Import(ContactId, UsRequest());

        Assert.False(resp.Success);
        Assert.Empty(CallsTo(rig.Procs, "DD_stpJob_InsertExceleratorAsync"));
        Assert.Equal(RefusedA, Assert.Single(resp.Jobs).ErrorMessage);
        Assert.Contains(resp.Messages, m => m.Message == $"Job US1: {RefusedA}");
    }
}
