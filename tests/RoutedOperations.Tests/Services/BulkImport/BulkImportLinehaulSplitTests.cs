using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkImport;

/// <summary>
/// UC #1115 M3, Bulk Import side. The parent and the linehaul total come from
/// fncT_BulkZoneRate_WithLinehaul (LinehaulSumAmount); Bulk Import only splits
/// that total across the legs' child jobs, pro rata to a per-leg weight. The
/// weight used to ignore the "Discount additional items" tick and the run rate,
/// so two legs on one schedule that differ in either got the wrong share of the
/// total: the client price was right, the courier child jobs were not.
///
/// Fixture = the M3 local repro (scratch repro_M3): leg Amount 25, client 14821
/// with a client + speed additional item percentage of 0.5, speed 160, 3 items,
/// fuel and PPD off. Expected values are the repro's case table, with cases 3/4
/// on the D2 default (Amount only, so the 0.5 zone % is ignored).
/// </summary>
public class BulkImportLinehaulSplitTests
{
    private const int ClientId = 14821;
    private const int SpeedId = 160;
    private const int RunA = 501;
    private const int RunB = 502;
    private const int ScheduleHeaderId = 6;
    private const int DayRowId = 8147;
    private const decimal ZoneBase = 8.89M;

    private static BulkImportServiceV2 Svc(Action<DynamicDespatchDbContext>? extra = null, decimal? clientDiscount = null)
    {
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "NZ");
        seed.TucClients.Add(new TucClient { UcclId = ClientId, UcclCode = "SC", UcclName = "Repro client", UcclActive = true, Discount = clientDiscount ?? 0M });
        seed.TblClientAvailableSpeeds.Add(new TblClientAvailableSpeed { Id = 1, ClientId = ClientId, SpeedId = SpeedId, Active = true, UseSchedules = true, AddonPercentage = 0.5M });
        extra?.Invoke(seed);
        seed.SaveChanges();
        return svc;
    }

    private static TblBulkScheduleLinehaul Leg(int id, int runId, bool? tick, decimal? amount = 25M, decimal? pct = 0M, bool? applyDiscount = false) => new()
    {
        Id = id, BulkRunScheduleId = DayRowId, LinehaulRunId = runId, Active = true,
        Amount = amount, AmountPercentage = pct, ApplyDiscount = applyDiscount, ApplyAddOnPercentage = tick,
    };

    private static BulkLinehaulRate RunRate(int runId, decimal amount) =>
        new() { Id = runId * 10, LinehaulRunId = runId, ScheduleId = ScheduleHeaderId, Amount = amount, Active = true };

    private static TblBulkJob Job(int qty) => new() { ClientId = ClientId, Speed = SpeedId, Qty = (short)qty, JobNumber = "J1" };

    private static readonly TblBulkRunSchedule Schedule = new() { BulkRunScheduleId = DayRowId, ScheduleId = ScheduleHeaderId };

    // Repro cases 1-6: one leg, 3 items. The weight IS the leg's linehaul charge.
    [Theory]
    [InlineData(1, true, 0, null, 50.00)]   // tick on: 25 + 2 x 12.50
    [InlineData(2, false, 0, null, 75.00)]  // tick off: 25 + 2 x 25 (the overcharge)
    [InlineData(3, true, 0.5, null, 50.00)] // D2: Amount wins, the 0.5 zone % is ignored
    [InlineData(4, false, 0.5, null, 75.00)]
    [InlineData(5, true, 0, 20.0, 40.00)]   // J2: run rate 20 wins over the leg's 25
    [InlineData(6, false, 0, 20.0, 60.00)]
    public void Repro_case_weight_is_the_job_creation_leg_charge(int reproCase, bool tick, double pct, double? runRate, double expected)
    {
        var svc = Svc(runRate.HasValue ? s => s.BulkLinehaulRates.Add(RunRate(RunA, (decimal)runRate.Value)) : null);

        var weights = svc.GetLinehaulLegWeights(new[] { Leg(1, RunA, tick, pct: (decimal)pct) }, Job(3), Schedule, ZoneBase, mfv: 0M);

        Assert.True((decimal)expected == weights[0], $"repro case {reproCase}: expected {expected}, got {weights[0]}");
    }

    // Repro cases 7/8: per-item dimension RATE 9. The fnc total (450 / 675) already
    // carries the RATE; with one leg the child takes all of it whatever the weight.
    [Theory]
    [InlineData(true, 450.00)]
    [InlineData(false, 675.00)]
    public void Repro_case_7_8_single_leg_child_gets_the_whole_fnc_total(bool tick, double fncLinehaulSum)
    {
        var svc = Svc();
        var weights = svc.GetLinehaulLegWeights(new[] { Leg(1, RunA, tick) }, Job(3), Schedule, ZoneBase, mfv: 0M);

        var split = BulkImportServiceV2.SplitLinehaulSum((decimal)fncLinehaulSum, weights);

        Assert.Equal((decimal)fncLinehaulSum, split.Single());
    }

    [Fact]
    public void Two_legs_differing_in_tick_split_the_total_by_what_each_leg_charges()
    {
        // fnc total for this booking: 50 (tick on) + 75 (tick off) = 125.
        var svc = Svc();
        var weights = svc.GetLinehaulLegWeights(new[] { Leg(1, RunA, true), Leg(2, RunB, false) }, Job(3), Schedule, ZoneBase, mfv: 0M);

        var split = BulkImportServiceV2.SplitLinehaulSum(125M, weights);

        // Old weights ignored the tick (25 / 25), giving 62.50 each.
        Assert.Equal(new[] { 50.00M, 75.00M }, split);
    }

    [Fact]
    public void Two_legs_differing_in_run_rate_split_the_total_by_the_run_rate()
    {
        // Leg A has run rate 20 (charged 40), leg B has none (charged 50); fnc total 90.
        var svc = Svc(s => s.BulkLinehaulRates.Add(RunRate(RunA, 20M)));
        var weights = svc.GetLinehaulLegWeights(new[] { Leg(1, RunA, true), Leg(2, RunB, true) }, Job(3), Schedule, ZoneBase, mfv: 0M);

        var split = BulkImportServiceV2.SplitLinehaulSum(90M, weights);

        // Old weights read the leg only (25 / 25), giving 45.00 each.
        Assert.Equal(new[] { 40.00M, 50.00M }, split);
    }

    [Fact]
    public void Single_item_booking_weight_is_unchanged_by_the_tick()
    {
        // SPEC test 7: one item prices exactly as before on every schedule.
        var svc = Svc();
        var weights = svc.GetLinehaulLegWeights(new[] { Leg(1, RunA, true), Leg(2, RunB, false) }, Job(1), Schedule, ZoneBase, mfv: 0M);

        Assert.Equal(new[] { 25.00M, 25.00M }, weights);
    }

    [Fact]
    public void Apply_client_discount_divides_the_leg_by_one_plus_discount()
    {
        // SPEC test 5: Discount 10%, ticked: 25 / 1.10 = 22.7273, 3 items at 50% = 45.45.
        var svc = Svc(clientDiscount: 0.10M);
        var weights = svc.GetLinehaulLegWeights(new[] { Leg(1, RunA, true, applyDiscount: true), Leg(2, RunB, true, applyDiscount: false) }, Job(3), Schedule, ZoneBase, mfv: 0M);

        Assert.Equal(new[] { 45.45M, 50.00M }, weights);
    }
}
