using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkImport;

/// <summary>
/// UC #1115 FIX3 (M1/M2). SplitJobAndApplyAmount prices items 2..n of a multi-item
/// Bulk Import job at amount x this percentage, and when the fnc gives no total
/// (km-priced jobs, the zone path with no linehaul rate) that sum IS the parent
/// job.Amount. #1115 must not move any Bulk Import parent amount, so this lookup
/// stays exactly as develop eace92a, warts included: the client + speed row of any
/// batch client x any batch speed, taken even at 0 or NULL-skipped, and a client
/// figure only when 0 &lt; x &lt;= 1. Each expected value below is what eace92a returns;
/// the SQL rule (LinehaulLegPricing.ResolveAddOnPercentage) would give the value in
/// the comment, and with it a different parent amount.
/// </summary>
public class BulkImportLegacyAddOnSplitTests
{
    private const int ClientA = 14821;
    private const int ClientB = 14822;
    private const int SpeedId = 160;

    private static BulkImportServiceV2 Svc(Action<DynamicDespatchDbContext> seedWith)
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "NZ");
        seed.TucClients.Add(new TucClient { UcclId = ClientA, UcclCode = "SA", UcclName = "Client A", UcclActive = true });
        seed.TucClients.Add(new TucClient { UcclId = ClientB, UcclCode = "SB", UcclName = "Client B", UcclActive = true });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = SpeedId, UcjtName = "Overnight", SystemName = "ON", AddonPercentage = 0.4M });
        seedWith(seed);
        seed.SaveChanges();
        return svc;
    }

    private static TblClientAvailableSpeed Cas(int id, int clientId, decimal? pct) =>
        new() { Id = id, ClientId = clientId, SpeedId = SpeedId, Active = true, UseSchedules = true, AddonPercentage = pct };

    private static TblBulkJob Job(int clientId, string number) => new() { ClientId = clientId, Speed = SpeedId, Qty = 3, JobNumber = number };

    // Mixed-client batch: A's own row is NULL (first row found), B's row is 0.6. develop takes A's NULL row,
    // falls through to A's client figure 0.7. The SQL rule with the batch-wide lists (FIX2) picked B's 0.6.
    // "First row found" relies on EF InMemory insertion order; on SQL Server the row is undefined (pre-existing bug).
    [Fact]
    public void Mixed_client_batch_keeps_the_develop_result()
    {
        var svc = Svc(s =>
        {
            s.TblClientAvailableSpeeds.Add(Cas(1, ClientA, null));
            s.TblClientAvailableSpeeds.Add(Cas(2, ClientB, 0.6M));
            s.TucClients.Local.Single(c => c.UcclId == ClientA).AddonPercentage = 0.7M;
        });
        var jobA = Job(ClientA, "A1");
        var batch = new List<TblBulkJob> { jobA, Job(ClientB, "B1") };

        Assert.Equal(0.7M, svc.ResolveAddOnPercentageLegacyBulkSplit(batch, jobA));
    }

    // Client + speed row at 0: develop prices items 2..n at 0 (parent = first item only). The SQL rule gives the
    // client's 0.7, which would treble a Qty 3 km parent's add-on part. Kept at 0 under #1115.
    [Fact]
    public void Client_speed_row_at_zero_keeps_the_develop_result()
    {
        var svc = Svc(s =>
        {
            s.TblClientAvailableSpeeds.Add(Cas(1, ClientA, 0M));
            s.TucClients.Local.Single(c => c.UcclId == ClientA).AddonPercentage = 0.7M;
        });
        var job = Job(ClientA, "A1");

        Assert.Equal(0M, svc.ResolveAddOnPercentageLegacyBulkSplit(new List<TblBulkJob> { job }, job));
    }

    // Client figure above 1: develop ignores it and takes the speed's 0.4. The SQL rule takes 1.2.
    [Fact]
    public void Client_figure_above_one_keeps_the_develop_result()
    {
        var svc = Svc(s => s.TucClients.Local.Single(c => c.UcclId == ClientA).AddonPercentage = 1.2M);
        var job = Job(ClientA, "A1");

        Assert.Equal(0.4M, svc.ResolveAddOnPercentageLegacyBulkSplit(new List<TblBulkJob> { job }, job));
    }
}
