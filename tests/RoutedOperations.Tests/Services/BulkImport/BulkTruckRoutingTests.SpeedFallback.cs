// UC #881 review fixes (Kevin, 17 Nov, option B). Before #881 an NZ
// point-to-point file never sent its Speed column, so a speed name the client
// does not have could not refuse a row and no truck-only check ran on a van row.
// The wizard now sends the column, and these tests hold the old behaviour for a
// point-to-point file while a file with truck rows keeps refusing unknown names,
// because there a wrong speed could book a truck as a van.
using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;

namespace RoutedOperations.Tests.Services.BulkImport;

public partial class BulkTruckRoutingTests
{
    [Fact]
    public async Task P2p_file_an_unknown_speed_name_books_on_the_batch_speed_and_says_so()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("P1", "Overnight"), Row("P2", "Economy")));

        Assert.True(resp.Success);
        var calls = rig.CallsTo("INT_stpJob_BulkInsertAsync");
        Assert.Equal(P2PSpeed, calls.Single(c => (string?)c["jobNumber"] == "P1")["speed"]);
        Assert.Equal(P2PEconomy, calls.Single(c => (string?)c["jobNumber"] == "P2")["speed"]);
        Assert.Contains(resp.Messages, m => m.Message == "Job P1: Speed 'Overnight' is not available for this client; the default speed was used.");
        Assert.DoesNotContain(resp.Jobs ?? [], j => !string.IsNullOrEmpty(j.ErrorMessage));
    }

    [Fact]
    public async Task P2p_file_an_unknown_speed_id_books_on_the_batch_speed_too()
    {
        var rig = NewRig();
        var row = Row("P1");
        row.SpeedId = 999;

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, row));

        Assert.Equal(P2PSpeed, Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"))["speed"]);
        Assert.Contains(resp.Messages, m => m.Message == "Job P1: Speed '999' is not available for this client; the default speed was used.");
    }

    [Fact]
    public async Task P2p_file_with_no_batch_speed_refuses_the_unknown_name()
    {
        // Every row names a speed, so the wizard sends 0 and there is nothing to fall back to.
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(0, Row("P1", "Overnight"), Row("P2", "Standard")));

        var refused = Assert.Single(resp.Jobs, j => !string.IsNullOrEmpty(j.ErrorMessage));
        Assert.Equal("P1", refused.JobNumber);
        Assert.Equal("Speed Overnight is not available for this client.", refused.ErrorMessage);
        Assert.Equal(P2PSpeed, Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"))["speed"]);
    }

    [Fact]
    public async Task Truck_file_an_unknown_speed_name_is_still_refused()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("T1", "TECO"), Row("P1", "Overnight")));

        Assert.Equal("Speed Overnight is not available for this client.", Assert.Single(resp.Jobs).ErrorMessage);
        Assert.Single(rig.Inserted);
        Assert.Equal(0, rig.P2PCalls);
        Assert.DoesNotContain(resp.Messages, m => m.Message.Contains("default speed was used"));
    }

    [Fact]
    public async Task A_file_with_truck_defaults_refuses_an_unknown_speed_name()
    {
        // TruckDefaults means the wizard saw truck rows in play, so this is not a P2P file.
        var rig = NewRig();
        var req = OnDemand(P2PSpeed, Row("P1", "Overnight"));
        req.TruckDefaults = new BulkTruckDefaults();

        var resp = await rig.Svc.Import(ContactId, req);

        Assert.Equal("Speed Overnight is not available for this client.", Assert.Single(resp.Jobs).ErrorMessage);
        Assert.Equal(0, rig.P2PCalls);
    }

    [Fact]
    public async Task A_truck_batch_speed_refuses_an_unknown_speed_name()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(Teco, Row("P1", "Overnight")));

        Assert.Equal("Speed Overnight is not available for this client.", Assert.Single(resp.Jobs).ErrorMessage);
        Assert.Empty(rig.Inserted);
    }

    [Fact]
    public async Task A_truck_speed_the_client_lacks_is_refused_even_in_an_otherwise_p2p_file()
    {
        // TSPR is a truck speed in tucJobType that this client cannot book. Falling
        // back would book a truck as a van, so the row counts as a truck row.
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(P2PSpeed, Row("T1", "TSPR"), Row("P1", "Overnight")));

        Assert.Equal(2, resp.Jobs.Count(j => j.ErrorMessage == $"Speed {j.Speed} is not available for this client."));
        Assert.Equal(0, rig.P2PCalls);
        Assert.Empty(rig.Inserted);
    }
}
