// M5a item lines. The expected rows come from real booking-page jobs on the local
// databases: NZ job 11126 (Banana Box) and US job 40050 (A4 SATCHEL). If a value
// here changes, a bulk job no longer matches a job booked on the page.
using System.Text.Json;
using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Services.BulkImport;

public class BulkP2PItemsTests
{
    private static P2PItemJob Job(int id = 1, short qty = 1, string number = "J1", decimal l = 53, decimal w = 39, decimal h = 24, decimal kg = 8, string? name = null) =>
        new(id, number, qty, l, w, h, kg, name);

    // ---- what a row's weight and cubic come to ----------------------------------

    [Theory]
    [InlineData("12.5", null, (short)3, "12.5", "37.5")]
    [InlineData("0", "37.5", (short)3, "12.5", "37.5")]
    [InlineData("12.5", "99", (short)3, "12.5", "37.5")]
    // 4 places, as a truck row: the items add up to 99.9999 against 100 rated.
    [InlineData("0", "100", (short)3, "33.3333", "100")]
    [InlineData("12.5", null, null, "12.5", "12.5")]
    [InlineData("12.5", null, (short)0, "12.5", "12.5")]
    [InlineData("0", "37.5", (short)-1, "37.5", "37.5")]
    [InlineData("0", null, (short)3, "0", "0")]
    public void Row_weight(string weight, string? total, short? qty, string perItem, string rated)
    {
        var result = P2PItemCalculator.RowWeight(decimal.Parse(weight), total == null ? null : decimal.Parse(total), qty);

        Assert.Equal(decimal.Parse(perItem), result.PerPallet);
        Assert.Equal(decimal.Parse(rated), result.Total);
    }

    [Theory]
    // round(50 x 40 x 30 x 0.000579, 3) x 3, the booking page's figure.
    [InlineData(false, null, "104.22")]
    [InlineData(true, null, "0.18")]
    public void Job_cubic(bool isNz, string? package, string expected)
    {
        Assert.Equal(decimal.Parse(expected), P2PItemCalculator.JobCubic(50, 40, 30, 3, package, isNz));
    }

    [Fact]
    public void Job_cubic_on_a_stock_size_skips_the_3_place_rounding_as_the_item_rows_do()
    {
        Assert.Equal(0.3057m, P2PItemCalculator.JobCubic(11, 16, 1, 3, "A4 SATCHEL", isNz: false));
        Assert.Equal(0.306m, P2PItemCalculator.JobCubic(11, 16, 1, 3, null, isNz: false));
    }

    [Theory]
    [InlineData(null)]
    [InlineData((short)0)]
    public void Job_cubic_counts_a_missing_quantity_as_one_item(short? qty)
    {
        Assert.Equal(34.74m, P2PItemCalculator.JobCubic(50, 40, 30, qty, null, isNz: false));
    }

    // ---- rows -----------------------------------------------------------------

    [Fact]
    public void Nz_stock_size_row_matches_booking_page_job_11126()
    {
        var item = Assert.Single(P2PItemCalculator.BuildItems(Job(number: "E280F", name: "Banana Box"), isNz: true));

        Assert.Equal(new P2PItemRow(1, 0, 1, 8d, 53d, 24d, 39d, 0.0496m, "Banana Box", "E280F-1"), item);
    }

    [Fact]
    public void Us_stock_size_row_matches_booking_page_job_40050()
    {
        var item = Assert.Single(P2PItemCalculator.BuildItems(Job(number: "P2094", l: 11, w: 16, h: 1, kg: 4, name: "A4 SATCHEL"), isNz: false));

        Assert.Equal(new P2PItemRow(1, 0, 1, 4d, 11d, 1d, 16d, 0.1019m, "A4 SATCHEL", "P2094-1"), item);
    }

    [Fact]
    public void A_quantity_of_n_gives_n_rows_numbered_from_zero_each_with_one_item_at_the_full_weight()
    {
        // Weight is per item: the job total is what trg_UpdateLiveJobTotals adds up.
        var items = P2PItemCalculator.BuildItems(Job(qty: 3, kg: 12.5m), isNz: true);

        Assert.Equal(new[] { 0, 1, 2 }, items.Select(i => i.ItemId));
        Assert.Equal(new[] { "J1-1", "J1-2", "J1-3" }, items.Select(i => i.Barcode));
        Assert.All(items, i => Assert.Equal(1, i.Items));
        Assert.All(items, i => Assert.Equal(12.5d, i.Weight));
    }

    [Fact]
    public void A_job_number_with_a_dash_is_the_barcode_as_it_is()
    {
        var items = P2PItemCalculator.BuildItems(Job(qty: 2, number: "J1-2"), isNz: true);

        Assert.All(items, i => Assert.Equal("J1-2", i.Barcode));
    }

    [Fact]
    public void A_typed_size_is_named_custom_and_never_takes_the_row_notes()
    {
        Assert.Equal("custom", P2PItemCalculator.BuildItems(Job(), isNz: true)[0].Notes);
        Assert.Equal("custom", P2PItemCalculator.BuildItems(Job(name: "  "), isNz: true)[0].Notes);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Zero_or_negative_quantity_gives_no_rows_as_the_page_loop_does(short qty)
    {
        Assert.Empty(P2PItemCalculator.BuildItems(Job(qty: qty), isNz: true));
    }

    [Theory]
    // Typed: rounded to 3 places by getRowCubicFeet. Stock: the exact figure, 4 places in the column.
    [InlineData(53, 39, 24, true, null, "0.05")]
    [InlineData(53, 39, 24, true, "Banana Box", "0.0496")]
    [InlineData(15, 26, 2, true, "DLE SATCHEL", "0.0008")]
    [InlineData(11, 16, 1, false, null, "0.102")]
    [InlineData(11, 16, 1, false, "A4 SATCHEL", "0.1019")]
    [InlineData(0, 0, 0, true, null, "0")]
    public void Cubic_uses_the_tenant_factor_and_the_page_rounding(int l, int w, int h, bool isNz, string? name, string expected)
    {
        Assert.Equal(decimal.Parse(expected, System.Globalization.CultureInfo.InvariantCulture), P2PItemCalculator.Cubic(Job(l: l, w: w, h: h, name: name), isNz));
    }

    [Theory]
    // DES_fncTruckJob_IsVanOK, with its limits copied rather than corrected.
    [InlineData(1, 8, 1, 1, 1, true)]
    [InlineData(1, 0, 0, 0, 0, true)]
    [InlineData(2, 8, 1, 1, 1, false)]
    [InlineData(1, 750, 1, 1, 1, false)]
    [InlineData(1, 8, 53, 39, 24, false)]
    public void VanOk_matches_the_function(short qty, int kg, int l, int w, int h, bool expected)
    {
        Assert.Equal(expected, P2PItemCalculator.VanOk(Job(qty: qty, kg: kg, l: l, w: w, h: h)));
    }

    // ---- SQL shape ------------------------------------------------------------

    [Fact]
    public void Every_json_property_is_read_by_the_insert()
    {
        // OPENJSON paths are case sensitive and a miss gives NULL rather than an error.
        var json = BulkP2PItemBatchSql.BuildItemsJson(new[] { Job() }, isNz: true);
        using var doc = JsonDocument.Parse(json);

        var props = doc.RootElement[0].EnumerateObject().Select(p => p.Name).ToList();
        Assert.Equal(new[] { "JobId", "ItemId", "Items", "Weight", "Length", "Height", "Depth", "Cubic", "Notes", "Barcode" }, props);
        foreach (var prop in props)
            Assert.Contains(prop, BulkP2PItemBatchSql.InsertSql);
    }

    [Fact]
    public void VanOk_json_has_one_entry_per_job()
    {
        var json = BulkP2PItemBatchSql.BuildVanOkJson(new[] { Job(id: 7, l: 1, w: 1, h: 1), Job(id: 8, qty: 2) });

        Assert.Equal("""[{"JobId":7,"VanOK":true},{"JobId":8,"VanOK":false}]""", json);
    }

    // ---- batching -------------------------------------------------------------

    private sealed class FakeSql : IP2PItemBatchSql
    {
        public HashSet<int> Couriers { get; } = new();
        public bool CourierLookupFails { get; init; }
        public List<IReadOnlyList<P2PItemJob>> Statements { get; } = new();
        public Func<IReadOnlyList<P2PItemJob>, Exception?> Fail { get; init; } = _ => null;

        public Task<IReadOnlySet<int>> JobsWithCourierAsync(IReadOnlyList<int> jobIds) =>
            CourierLookupFails ? throw new InvalidOperationException("no") : Task.FromResult<IReadOnlySet<int>>(Couriers);

        public Task InsertBatchAsync(IReadOnlyList<P2PItemJob> jobs, bool isNz)
        {
            Statements.Add(jobs);
            var ex = Fail(jobs);
            return ex == null ? Task.CompletedTask : throw ex;
        }
    }

    private static BulkP2PItemInserter Inserter(FakeSql sql) => new(sql, _ => Task.CompletedTask);

    private static readonly IReadOnlySet<int> NoCouriers = new HashSet<int>();

    [Fact]
    public void Jobs_share_a_statement_up_to_the_item_limit_and_a_job_is_never_split()
    {
        var jobs = new[] { Job(1, 300), Job(2, 200), Job(3, 1), Job(4, 900), Job(5, 1) };

        var batches = BulkP2PItemInserter.PlanBatches(jobs, NoCouriers);

        Assert.Equal(new[] { new[] { 1, 2 }, new[] { 3 }, new[] { 4 }, new[] { 5 } }, batches.Select(b => b.Select(j => j.JobId).ToArray()));
    }

    [Fact]
    public void A_job_with_a_courier_never_shares_a_statement()
    {
        // tucJob_Update_SendToDevices reads one row of deleted, so in a shared
        // statement a driver might never hear about their job changing.
        var batches = BulkP2PItemInserter.PlanBatches(new[] { Job(1), Job(2), Job(3) }, new HashSet<int> { 2 });

        Assert.Contains(batches, b => b.Count == 1 && b[0].JobId == 2);
        Assert.Contains(batches, b => b.Select(j => j.JobId).SequenceEqual(new[] { 1, 3 }));
    }

    [Fact]
    public void A_job_with_no_items_writes_nothing_so_its_VanOK_is_left_alone()
    {
        Assert.Empty(BulkP2PItemInserter.PlanBatches(new[] { Job(1, 0) }, NoCouriers));
    }

    [Fact]
    public async Task A_thousand_jobs_take_two_statements_not_a_thousand_calls()
    {
        var sql = new FakeSql();
        var jobs = Enumerable.Range(1, 1000).Select(i => Job(i)).ToList();

        var failures = await Inserter(sql).InsertAsync(jobs, isNz: true);

        Assert.Empty(failures);
        Assert.Equal(2, sql.Statements.Count);
    }

    [Fact]
    public async Task An_unknown_courier_state_falls_back_to_job_by_job()
    {
        var sql = new FakeSql { CourierLookupFails = true };

        await Inserter(sql).InsertAsync(new[] { Job(1), Job(2) }, isNz: true);

        Assert.Equal(2, sql.Statements.Count);
    }

    [Fact]
    public async Task A_deadlock_retries_the_same_batch()
    {
        int calls = 0;
        var sql = new FakeSql { Fail = _ => ++calls == 1 ? new P2PItemDeadlockException(new Exception("1205")) : null };

        var failures = await Inserter(sql).InsertAsync(new[] { Job(1), Job(2) }, isNz: true);

        Assert.Empty(failures);
        Assert.Equal(2, sql.Statements.Count);
        Assert.Equal(2, sql.Statements[1].Count);
    }

    [Fact]
    public async Task One_bad_job_fails_alone_and_the_others_still_get_their_items()
    {
        var sql = new FakeSql { Fail = jobs => jobs.Any(j => j.JobId == 2) ? new InvalidOperationException("bad") : null };

        var failures = await Inserter(sql).InsertAsync(new[] { Job(1), Job(2, number: "J2"), Job(3) }, isNz: true);

        Assert.Equal(new P2PItemFailure("J2", "bad"), Assert.Single(failures));
        Assert.Contains(sql.Statements, b => b.Count == 1 && b[0].JobId == 1);
        Assert.Contains(sql.Statements, b => b.Count == 1 && b[0].JobId == 3);
    }

    [Fact]
    public async Task A_job_stuck_in_deadlocks_is_reported_with_the_sql_message()
    {
        var sql = new FakeSql { Fail = _ => new P2PItemDeadlockException(new Exception("victim")) };

        var failures = await Inserter(sql).InsertAsync(new[] { Job(1) }, isNz: true);

        Assert.Equal(new P2PItemFailure("J1", "victim"), Assert.Single(failures));
        Assert.Equal(BulkP2PItemInserter.MaxDeadlockAttempts, sql.Statements.Count);
    }

    [Fact]
    public async Task No_jobs_makes_no_database_call()
    {
        var sql = new FakeSql { CourierLookupFails = true };

        Assert.Empty(await Inserter(sql).InsertAsync(Array.Empty<P2PItemJob>(), isNz: true));
        Assert.Empty(sql.Statements);
    }
}
