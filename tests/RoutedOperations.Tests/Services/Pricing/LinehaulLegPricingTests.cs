using RoutedOperations.Core.Application.Services.Pricing;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Pricing;

/// <summary>
/// UC #1115. The additional item percentage and the D2 rule that Bulk Import's linehaul
/// child split weights use (BulkImportRatingService.InsertLinehaulJobs). They must match
/// the SQL that charges the job, or the split weights a leg by a price nobody is charged.
/// Kept from the removed schedule price preview tests (FIX5), now against the helper itself.
/// </summary>
public class LinehaulLegPricingTests
{
    private const int ClientA = 14821;
    private const int SpeedId = 160;

    private static DynamicDespatchDbContext Seed(Action<DynamicDespatchDbContext> seedWith)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        var seed = CockpitTestHarness.Context(opts);
        seed.TucClients.Add(new TucClient { UcclId = ClientA, UcclCode = "SA", UcclName = "Client A", UcclActive = true });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = SpeedId, UcjtName = "Linehaul", SystemName = "LH" });
        seedWith(seed);
        seed.SaveChanges();
        return CockpitTestHarness.Context(opts);
    }

    private static void ClientSpeed(DynamicDespatchDbContext s, decimal pct) =>
        s.TblClientAvailableSpeeds.Add(new TblClientAvailableSpeed { Id = 1, ClientId = ClientA, SpeedId = SpeedId, Active = true, UseSchedules = true, AddonPercentage = pct });

    // SPEC section 4: client + speed, then client, then speed, then the default.
    [Theory]
    [InlineData(true, 0.6, 0.7, 0.5)]
    [InlineData(false, 0.6, 0.7, 0.6)]
    [InlineData(false, null, 0.7, 0.7)]
    [InlineData(false, null, null, -1)]
    public void Additional_item_percentage_order(bool clientSpeedRow, double? clientPct, double? speedPct, double expected)
    {
        var ctx = Seed(s =>
        {
            if (clientSpeedRow) ClientSpeed(s, 0.5M);
            s.TucClients.Local.Single(c => c.UcclId == ClientA).AddonPercentage = (decimal?)clientPct;
            s.TucJobTypes.Local.Single(t => t.UcjtId == SpeedId).AddonPercentage = (decimal?)speedPct;
        });

        var want = expected < 0 ? LinehaulLegPricing.DefaultAddOnPercentage() : (decimal)expected;
        Assert.Equal(want, LinehaulLegPricing.ResolveAddOnPercentage(ctx, ClientA, SpeedId));
    }

    // ROSPEC F1: the same edges as the SQL that charges the job (fncT 20261126200000 lines 116 and 209-214,
    // WS_ 20261126200100 lines 1655-1666). A client + speed row counts only when above 0, else the client's
    // own figure when not 0 (above 1 included), else the speed's when above 0, else the default. Urgent prod
    // has client + speed rows at 0 (client 5023 on speed 147): job creation charges speed 147's 100% there.
    // casPct null = no client + speed row; expected -1 = the default.
    [Theory]
    [InlineData(0.0, null, 1.0, 1.0)]
    [InlineData(0.0, 0.7, 0.4, 0.7)]
    [InlineData(null, 1.2, 0.4, 1.2)]
    [InlineData(null, 0.0, 0.4, 0.4)]
    [InlineData(null, null, 0.0, -1)]
    public void Additional_item_percentage_skips_zero_figures_like_the_sql(double? casPct, double? clientPct, double? speedPct, double expected)
    {
        var ctx = Seed(s =>
        {
            if (casPct.HasValue) ClientSpeed(s, (decimal)casPct.Value);
            s.TucClients.Local.Single(c => c.UcclId == ClientA).AddonPercentage = (decimal?)clientPct;
            s.TucJobTypes.Local.Single(t => t.UcjtId == SpeedId).AddonPercentage = (decimal?)speedPct;
        });

        var want = expected < 0 ? LinehaulLegPricing.DefaultAddOnPercentage() : (decimal)expected;
        Assert.Equal(want, LinehaulLegPricing.ResolveAddOnPercentage(ctx, ClientA, SpeedId));
    }

    // S1 row 8: a speed with no tucJobType row leaves the SQL on the client step's 0 (fncT 20261126200000
    // lines 209-214 assign only when the tucJobType row exists), so 0, not the 0.8 default.
    [Fact]
    public void Speed_with_no_job_type_row_keeps_the_client_step_zero_like_the_sql()
    {
        var ctx = Seed(_ => { });

        Assert.Equal(0M, LinehaulLegPricing.ResolveAddOnPercentage(ctx, ClientA, 999));
    }

    // D2 with a known zone base (Bulk Import weights): Amount only today, Amount + zone base x % if switched.
    [Theory]
    [InlineData(true, 25.00)]
    [InlineData(false, 30.00)]
    public void D2_switch_with_a_known_zone_base(bool amountOnly, double expected)
    {
        Assert.Equal((decimal)expected, LinehaulLegPricing.RawLegPrice(new LinehaulLegPricing.LegFigures(25M, 0.5M, false), 10M, amountOnly));
    }
}
