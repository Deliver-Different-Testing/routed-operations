// The client reference check on NZ New Import, the truck preview and the
// /reference-check endpoint. INT_stpJob_BulkInsert checks no reference, so on NZ a row
// this misses is a live job with a blank or invalid reference.
using NSubstitute.Extensions;
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkImport;

public partial class BulkTruckRoutingTests
{
    private const string RequireA = "Require \"Reference A\" - \"\"";

    private static void ReferenceClient(Rig rig, bool aMandatory = true, bool bMandatory = false, bool aList = false, params string[] listA)
    {
        rig.Preflight.Configure().LoadClientsAsync(default!).ReturnsForAnyArgs(call => Task.FromResult<IReadOnlyDictionary<int, TruckClientFacts>>(
            call.Arg<IReadOnlyCollection<int>>().ToDictionary(c => c, c => new TruckClientFacts(c, "ACME", null, false, aMandatory, null, bMandatory, "cost centre", aList))));
        rig.Preflight.Configure().ReferenceListsAsync(default!).ReturnsForAnyArgs(call => Task.FromResult<IReadOnlyDictionary<int, ReferenceListResult>>(
            call.Arg<IReadOnlyList<ReferenceCheckRow>>().ToDictionary(r => r.RowNo, r => new ReferenceListResult(listA.Contains(r.ReferenceA), true))));
    }

    private static BulkImportJobCreateDto WithRef(BulkImportJobCreateDto job, string? refA)
    {
        job.ClientRefA = refA;
        return job;
    }

    [Fact]
    public async Task Nz_wizard_refused_rows_miss_both_paths_and_the_rest_still_book()
    {
        var rig = NewRig();
        ReferenceClient(rig);

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed,
            Row("P1"), Row("T1", "TECO"), WithRef(Row("P2"), "PO1"), WithRef(Row("T2", "TECO"), "PO2")));

        Assert.True(resp.Success);
        Assert.Equal("P2", Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"))["jobNumber"]);
        Assert.Equal("T2", Assert.Single(rig.Inserted).ucjbNumber);
        Assert.Equal(new[] { "P1", "T1" }, resp.Jobs.Select(j => j.JobNumber));
        Assert.All(resp.Jobs, j => Assert.Equal(RequireA, j.ErrorMessage));
        Assert.All(resp.Jobs, j => Assert.True(j.TruckRejected));
    }

    [Fact]
    public async Task Nz_wizard_a_refused_row_takes_no_job_number()
    {
        // Assigning numbers throws under EF InMemory, so this only returns if none was asked for.
        var rig = NewRig();
        ReferenceClient(rig);

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("AUTOGENERATE"), WithRef(Row("P1"), "PO1")));

        Assert.True(resp.Success);
        Assert.Equal("P1", Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"))["jobNumber"]);
        Assert.Equal(RequireA, Assert.Single(resp.Jobs).ErrorMessage);
    }

    [Fact]
    public async Task Nz_wizard_reports_A_and_B_together_for_a_truck_row_too()
    {
        var rig = NewRig();
        ReferenceClient(rig, bMandatory: true);

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("T1", "TECO")));

        Assert.False(resp.Success);
        Assert.Empty(rig.Inserted);
        Assert.Equal($"{RequireA}\r\nRequire \"Reference B\" - \"cost centre\"", Assert.Single(resp.Jobs).ErrorMessage);
    }

    [Fact]
    public async Task Nz_wizard_define_list_is_enforced_and_only_asked_when_the_client_has_one()
    {
        var withList = NewRig();
        ReferenceClient(withList, aMandatory: false, aList: true, listA: "GOOD");
        var resp = await withList.Svc.Import(ContactId, OnDemand(P2PSpeed, WithRef(Row("P1"), "NOPE"), WithRef(Row("P2"), "GOOD")));
        Assert.Equal("\"Reference A\" - \"NOPE\" not in defined list.", Assert.Single(resp.Jobs).ErrorMessage);
        Assert.Equal("P2", Assert.Single(withList.CallsTo("INT_stpJob_BulkInsertAsync"))["jobNumber"]);

        var noList = NewRig();
        await noList.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("P1")));
        await noList.Preflight.DidNotReceiveWithAnyArgs().ReferenceListsAsync(default!);
        Assert.Single(noList.CallsTo("INT_stpJob_BulkInsertAsync"));
    }

    [Fact]
    public async Task Preview_shows_a_refused_row_with_the_same_wording_the_import_gives()
    {
        var rig = NewRig();
        ReferenceClient(rig);

        var preview = await rig.Svc.PreviewTruckRows(ContactId, OnDemand(P2PSpeed, Row("P1"), WithRef(Row("T1", "TECO"), "PO1")));

        Assert.Equal(0, preview.OtherRowCount);
        var refused = Assert.Single(preview.Rows, r => !r.WouldImport);
        Assert.Equal("P1", refused.JobNumber);
        Assert.Equal(RequireA, refused.Reason);
        Assert.Equal("T1", Assert.Single(preview.Rows, r => r.WouldImport).JobNumber);
    }

    // ---- POST /reference-check --------------------------------------------------

    private static BulkReferenceCheckRequest Check(params BulkReferenceCheckRow[] rows) => new() { Rows = rows.ToList() };

    [Fact]
    public async Task Check_returns_only_the_refused_rows_under_the_numbers_sent_and_writes_nothing()
    {
        var rig = NewRig();
        ReferenceClient(rig);

        var resp = await rig.Svc.CheckReferences(ContactId, Check(
            new BulkReferenceCheckRow { RowNumber = 4, ClientId = ClientId, ReferenceA = "PO1" },
            new BulkReferenceCheckRow { RowNumber = 7, ClientId = ClientId, ReferenceA = "   " },
            new BulkReferenceCheckRow { RowNumber = 9, ClientCode = " acme ", ReferenceA = null }));

        Assert.True(resp.Success);
        Assert.Equal(new[] { 7, 9 }, resp.Errors.Select(e => e.RowNumber));
        Assert.All(resp.Errors, e => Assert.Equal(RequireA, e.Error));
        Assert.Empty(rig.Procs.ReceivedCalls());
        Assert.Empty(rig.Inserted);
    }

    [Fact]
    public async Task Check_says_client_not_found_in_the_words_staff_import_uses()
    {
        var rig = NewRig();

        var resp = await rig.Svc.CheckReferences(ContactId, Check(new BulkReferenceCheckRow { RowNumber = 2, ClientId = 999 }, new BulkReferenceCheckRow { RowNumber = 3, ClientCode = "NOPE" }));

        Assert.Equal(new[] { "Client not found. ClientID: 999, ClientCode: ", "Client not found. ClientID: , ClientCode: NOPE" }, resp.Errors.Select(e => e.Error));
    }

    [Fact]
    public async Task Check_will_not_show_a_customer_another_clients_reference_settings()
    {
        var rig = NewRig(clientTypeId: "2");
        ReferenceClient(rig);
        rig.Seed.TucClients.Add(new TucClient { UcclId = 6, UcclCode = "OTHER", UcclName = "Other", UcclActive = true });
        rig.Seed.SaveChanges();

        var resp = await rig.Svc.CheckReferences(ContactId, Check(
            new BulkReferenceCheckRow { RowNumber = 1, ClientId = ClientId },
            new BulkReferenceCheckRow { RowNumber = 2, ClientId = 6 }));

        Assert.Equal(RequireA, resp.Errors[0].Error);
        Assert.Equal("Client not found. ClientID: 6, ClientCode: ", resp.Errors[1].Error);
        await rig.Preflight.Received(1).LoadClientsAsync(Arg.Is<IReadOnlyCollection<int>>(ids => !ids.Contains(6)));
    }

    [Fact]
    public async Task Check_with_no_rows_succeeds_and_asks_nothing()
    {
        var rig = NewRig();
        var resp = await rig.Svc.CheckReferences(ContactId, new BulkReferenceCheckRequest());
        Assert.True(resp.Success);
        Assert.Empty(resp.Errors);
        await rig.Preflight.DidNotReceiveWithAnyArgs().LoadClientsAsync(default!);
    }
}
