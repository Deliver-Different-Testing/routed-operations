// UC #881. When every NZ on-demand row names its own Speed, the defaults-step
// Speed is never used, so the wizard no longer makes the operator pick one and
// sends 0. Before this the server looked up speed 0, found nothing and refused
// the whole file with "Invalid speed.". Each row's speed is still checked
// against the client by SplitTruckRows.
namespace RoutedOperations.Tests.Services.BulkImport;

public partial class BulkTruckRoutingTests
{
    [Fact]
    public async Task No_batch_speed_is_needed_when_every_row_has_one()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(0, Row("T1", "TECO"), Row("P1", "Standard")));

        Assert.True(resp.Success);
        Assert.Equal(Teco, Assert.Single(rig.Inserted).ucjbSpeed);
        Assert.Equal(P2PSpeed, Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"))["speed"]);
    }

    [Fact]
    public async Task A_row_with_no_speed_still_needs_the_batch_speed()
    {
        var rig = NewRig();

        var resp = await rig.Svc.Import(ContactId, OnDemand(0, Row("T1", "TECO"), Row("P1")));

        Assert.False(resp.Success);
        Assert.Contains(resp.Messages, m => m.Message == "Invalid speed.");
        Assert.Empty(rig.Inserted);
    }
}
