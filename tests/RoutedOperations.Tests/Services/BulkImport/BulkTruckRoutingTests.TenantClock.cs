// UC #881 F3. Import-as-completed stamps the tenant's clock, on the P2P and
// truck paths alike. Before this both used the web server's clock.
namespace RoutedOperations.Tests.Services.BulkImport;

public partial class BulkTruckRoutingTests
{
    [Fact]
    public async Task Import_as_completed_uses_tenant_time_on_both_paths()
    {
        var rig = NewRig(timeZone: BulkImportTenantClock.Zone);
        var request = OnDemand(P2PSpeed, Row("T1", "TECO"), Row("P1"));
        request.ImportAsCompleted = true;

        var resp = await rig.Svc.Import(ContactId, request);

        Assert.True(resp.Success);
        BulkImportTenantClock.AssertNear(Assert.Single(rig.Inserted).ucjbComplTime);
        BulkImportTenantClock.AssertNear((DateTime?)Assert.Single(rig.CallsTo("INT_stpJob_BulkInsertAsync"))["complTime"]);
    }
}
