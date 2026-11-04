// The batching rules exist because tucJob_InsertJob and the clear-list trigger read
// single values from `inserted`. A courier row or a code-specific client sharing a
// statement would let one arbitrary row decide the SMS, FTP or clear-list outcome
// for all of them. No SQL runs here: the batch writer is a fake.
using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Services.BulkImport;

public class BulkTruckInserterTests
{
    private sealed class FakeBatchSql(Func<IReadOnlyList<TruckInsertRow>, int, Exception?> fail) : ITruckBatchSql
    {
        public List<IReadOnlyList<TruckInsertRow>> Calls { get; } = new();

        public Task<IReadOnlyDictionary<string, int>> InsertBatchAsync(IReadOnlyList<TruckInsertRow> rows, DateTime noteCreatedAt)
        {
            Calls.Add(rows);
            var ex = fail(rows, Calls.Count);
            if (ex != null) throw ex;
            IReadOnlyDictionary<string, int> ids = rows.ToDictionary(r => r.ucjbNumber, r => 1000 + r.RowNo);
            return Task.FromResult(ids);
        }
    }

    private static TruckInsertRow Row(int rowNo, int client = 5, bool alone = false) => new()
    {
        RowNo = rowNo,
        ucjbNumber = $"T{rowNo}",
        ucjbClientID = client,
        MustInsertAlone = alone,
    };

    private static BulkTruckInserter Inserter(ITruckBatchSql sql) => new(sql, _ => Task.CompletedTask);

    [Fact]
    public void Each_client_gets_its_own_statement()
    {
        var batches = BulkTruckInserter.PlanBatches(new[] { Row(0, 5), Row(1, 6), Row(2, 5) });
        Assert.Equal(2, batches.Count);
        Assert.All(batches, b => Assert.Single(b.Select(r => r.ucjbClientID).Distinct()));
    }

    [Fact]
    public void Rows_that_must_go_alone_never_share_a_statement()
    {
        var batches = BulkTruckInserter.PlanBatches(new[] { Row(0), Row(1, alone: true), Row(2), Row(3, alone: true) });
        Assert.Equal(3, batches.Count);
        Assert.Single(batches, b => b.Count == 2);
        Assert.Equal(2, batches.Count(b => b.Count == 1 && b[0].MustInsertAlone));
    }

    [Fact]
    public void A_large_file_is_chunked_into_batches_of_the_maximum()
    {
        var rows = Enumerable.Range(0, BulkTruckInserter.MaxBatchRows + 1).Select(i => Row(i)).ToList();
        var batches = BulkTruckInserter.PlanBatches(rows);
        Assert.Equal(new[] { BulkTruckInserter.MaxBatchRows, 1 }, batches.Select(b => b.Count));
    }

    [Theory]
    [InlineData("SCSDA")]
    [InlineData("ROREE")]
    [InlineData("ZIMCH")]
    [InlineData("STRCH")]
    [InlineData("DRIVE")]
    [InlineData("#DABC")]
    [InlineData("WOOPW")]
    public void Trigger_listed_client_codes_never_go_multi_row(string code) =>
        Assert.True(TruckRowCalculator.IsSingleRowClient(1, code));

    [Fact]
    public void An_ordinary_client_can_go_multi_row() =>
        Assert.False(TruckRowCalculator.IsSingleRowClient(5, "ACME"));

    [Fact]
    public async Task A_deadlock_retries_the_same_batch()
    {
        var sql = new FakeBatchSql((_, call) => call == 1 ? new TruckDeadlockException(new Exception("1205")) : null);
        var outcomes = await Inserter(sql).InsertAsync(new[] { Row(0), Row(1) }, DateTime.Now);
        Assert.Equal(2, sql.Calls.Count);
        Assert.Equal(2, sql.Calls[1].Count);
        Assert.All(outcomes, o => Assert.NotNull(o.JobId));
    }

    [Fact]
    public async Task One_bad_row_fails_alone_and_the_rest_still_import()
    {
        // The batch transaction rolls back as a whole, then rows retry one by one.
        var sql = new FakeBatchSql((rows, _) => rows.Any(r => r.ucjbNumber == "T1") ? new InvalidOperationException("bad row") : null);
        var outcomes = await Inserter(sql).InsertAsync(new[] { Row(0), Row(1), Row(2) }, DateTime.Now);

        Assert.Equal(3, outcomes.Count);
        var bad = Assert.Single(outcomes, o => o.JobId == null);
        Assert.Equal(1, bad.RowNo);
        Assert.Contains("bad row", bad.Error);
        Assert.Equal(new[] { 0, 2 }, outcomes.Where(o => o.JobId != null).Select(o => o.RowNo).OrderBy(n => n));
    }

    [Fact]
    public async Task A_failing_single_row_is_not_retried_forever()
    {
        var sql = new FakeBatchSql((_, _) => new InvalidOperationException("always"));
        var outcomes = await Inserter(sql).InsertAsync(new[] { Row(0) }, DateTime.Now);
        Assert.Single(sql.Calls);
        Assert.Null(Assert.Single(outcomes).JobId);
    }

    [Fact]
    public async Task A_row_stuck_in_deadlocks_gives_up_and_reports_a_failure()
    {
        var sql = new FakeBatchSql((_, _) => new TruckDeadlockException(new Exception("1205")));
        var outcomes = await Inserter(sql).InsertAsync(new[] { Row(0) }, DateTime.Now);
        Assert.Equal(BulkTruckInserter.MaxDeadlockAttempts, sql.Calls.Count);
        Assert.Null(Assert.Single(outcomes).JobId);
    }
}
