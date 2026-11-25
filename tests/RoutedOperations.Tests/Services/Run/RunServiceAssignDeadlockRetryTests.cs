using System.Data.Common;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Tests.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.Run;

/// <summary>
/// #1018 rework (Steve 26 Nov): since C4 an assign can be the deadlock victim
/// against the EF / legacy paths that write tblBulkJob first (see
/// RunAssignLocks). The operator then saw a 500 for an assign that would have
/// gone through a moment later. The assign now runs its whole unit of work
/// once more on 1205: new transaction, locks taken again, the fromRunId check
/// read again from the database, never the first attempt's in-memory state.
///
/// SQLite stands in for SQL Server (it honours the transaction). An
/// interceptor throws a real-shaped SqlException 1205 from the chosen command,
/// the way SqlClient raises it when the server picks the session as victim;
/// thrown from SaveChanges EF wraps it in DbUpdateException, as it does live.
/// Attempts are counted as transactions started.
/// </summary>
public class RunServiceAssignDeadlockRetryTests
{
    private static readonly DateTime Date = new(2026, 11, 26);

    private sealed class Faults(Func<string, bool> where, int times, int number) : DbCommandInterceptor, IDbTransactionInterceptor
    {
        public int Thrown { get; private set; }
        public int Transactions { get; private set; }

        private void Maybe(DbCommand command)
        {
            if (Thrown >= times || !where(command.CommandText.TrimStart())) return;
            Thrown++;
            throw RouteViewerRunCourierRejectTests.MakeSqlException(number,
                number == 1205
                    ? "Transaction (Process ID 61) was deadlocked on lock resources with another process and has been chosen as the deadlock victim. Rerun the transaction."
                    : "Violation of PRIMARY KEY constraint.");
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Maybe(command);
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Maybe(command);
            return ValueTask.FromResult(result);
        }

        public ValueTask<DbTransaction> TransactionStartedAsync(DbConnection connection, TransactionEndEventData eventData,
            DbTransaction result, CancellationToken cancellationToken = default)
        {
            Transactions++;
            return ValueTask.FromResult(result);
        }
    }

    /// <summary>SaveChanges writes (EF wraps the SqlException in DbUpdateException).</summary>
    private static bool OnSave(string sql) =>
        sql.StartsWith("UPDATE", StringComparison.OrdinalIgnoreCase) || sql.StartsWith("INSERT", StringComparison.OrdinalIgnoreCase);

    /// <summary>The link-row LINQ read (raw SqlException). On SQL Server the locks come from the raw lock statement, covered only by the opt-in RunAssignConcurrencySqlServerTests.</summary>
    private static bool OnLinkRead(string sql) =>
        sql.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase) && sql.Contains("FROM \"tblBulkJobRun\"", StringComparison.Ordinal);

    private static (RunService Svc, Faults Faults, Core.Domain.DynamicDespatchDbContext Seed, DbConnection Conn,
        DbContextOptions<Core.Domain.DespatchContext> Opts) NewSvc(Func<string, bool> where, int times, int number = 1205)
    {
        var (opts, conn) = CockpitTestHarness.NewSqliteOptions();
        var faults = new Faults(where, times, number);
        var svcOpts = new DbContextOptionsBuilder<Core.Domain.DespatchContext>(opts).AddInterceptors(faults).Options;
        var svc = new RunService(CockpitTestHarness.Factory(svcOpts), RoutedOperations.Tests.Branches.BranchTestDoubles.Unrestricted());
        return (svc, faults, CockpitTestHarness.Context(opts), conn, opts);
    }

    private static TblBulkJob NewJob(int id, int? bulkRunId = null) => new()
    {
        BulkJobId = id, JobNumber = "J" + id, ClientId = 1, ClientCode = "C",
        BookDate = Date, BookTime = Date, FromAddress = "F", ToAddress = "T", BulkRunId = bulkRunId,
    };

    /// <summary>Job 10 on run 1, runs 1 and 2. The operator moves it 1 -> 2.</summary>
    private static async Task SeedJobOnRun1Async(Core.Domain.DynamicDespatchDbContext seed)
    {
        seed.TblBulkRuns.AddRange(
            new TblBulkRun { Id = 1, Name = "From", Status = 0, DespatchDateTime = Date },
            new TblBulkRun { Id = 2, Name = "To", Status = 0, DespatchDateTime = Date });
        seed.TblBulkJobs.Add(NewJob(10, bulkRunId: 1));
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { RunId = 1, BulkJobId = 10 });
        await seed.SaveChangesAsync();
    }

    private static List<AssignJobItem> Move10From1() => [new() { JobId = 10, FromRunId = 1 }];

    [Theory]
    [InlineData("save")]
    [InlineData("link-read")]
    public async Task Assign_chosen_as_deadlock_victim_once_succeeds_on_the_second_attempt_and_the_job_lands_on_the_target_once(string where)
    {
        var (svc, faults, seed, conn, opts) = NewSvc(where == "save" ? OnSave : OnLinkRead, times: 1);
        await SeedJobOnRun1Async(seed);

        var (result, message) = await svc.AssignJobsToRunAsync(2, Move10From1());

        Assert.Equal(("Success", "1"), (result, message));
        Assert.Equal(1, faults.Thrown);
        Assert.Equal(RunService.MaxAssignDeadlockAttempts, faults.Transactions);
        using var verify = CockpitTestHarness.Context(opts);
        // Exactly once: one link row, on the target, and the job row mirrors it.
        // The second attempt must read the link from the database (still run 1),
        // not the first attempt's tracked entity it had already moved to run 2,
        // or the fromRunId check reports "moved by another user".
        Assert.Equal(2, verify.TblBulkJobRuns.Single(l => l.BulkJobId == 10).RunId);
        Assert.Equal(2, verify.TblBulkJobs.Single(j => j.BulkJobId == 10).BulkRunId);
        conn.Dispose();
    }

    [Fact]
    public async Task Merge_chosen_as_deadlock_victim_on_the_source_delete_replays_the_whole_merge_not_just_the_delete()
    {
        // Fault the second SaveChanges (the source-run delete); the first, the
        // job moves, has already run inside the doomed transaction.
        var (svc, faults, seed, conn, opts) = NewSvc(sql => sql.StartsWith("DELETE", StringComparison.OrdinalIgnoreCase), times: 1);
        await SeedJobOnRun1Async(seed);

        var (result, _) = await svc.AssignJobsToRunAsync(2, Move10From1(), deleteRunId: 1);

        Assert.Equal("Success", result);
        Assert.Equal(RunService.MaxAssignDeadlockAttempts, faults.Transactions);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Equal(2, verify.TblBulkRuns.Single().Id);
        Assert.Equal(2, verify.TblBulkJobRuns.Single().RunId);
        Assert.Equal(2, verify.TblBulkJobs.Single().BulkRunId);
        conn.Dispose();
    }

    [Fact]
    public async Task Create_run_with_jobs_chosen_as_deadlock_victim_once_creates_exactly_one_run()
    {
        var (svc, faults, seed, conn, opts) = NewSvc(OnSave, times: 1);
        seed.TblBulkJobs.AddRange(NewJob(10), NewJob(11));
        await seed.SaveChangesAsync();

        var (result, message) = await svc.CreateRunWithJobsAsync(new InsertOrUpdateRunRequest
        {
            Name = "4410", Status = 0, DespatchDateTime = Date,
            Jobs = [new RunJobDto { BulkJobId = 10 }, new RunJobDto { BulkJobId = 11 }],
        });

        Assert.Equal("Success", result);
        Assert.Equal(RunService.MaxAssignDeadlockAttempts, faults.Transactions);
        var runId = int.Parse(message);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Equal(runId, verify.TblBulkRuns.Single().Id);
        Assert.Equal(2, verify.TblBulkJobRuns.Count(l => l.RunId == runId));
        Assert.All(verify.TblBulkJobs, j => Assert.Equal(runId, j.BulkRunId));
        conn.Dispose();
    }

    [Fact]
    public async Task Assign_chosen_as_deadlock_victim_twice_surfaces_the_deadlock_after_exactly_two_attempts()
    {
        var (svc, faults, seed, conn, opts) = NewSvc(OnSave, times: int.MaxValue);
        await SeedJobOnRun1Async(seed);

        var ex = await Assert.ThrowsAnyAsync<Exception>(() => svc.AssignJobsToRunAsync(2, Move10From1()));

        // Surfaces as today: the same exception type, carrying the 1205.
        Assert.IsType<DbUpdateException>(ex);
        Assert.Equal(1205, Assert.IsType<SqlException>(ex.InnerException).Number);
        Assert.Equal(RunService.MaxAssignDeadlockAttempts, faults.Transactions);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Equal(1, verify.TblBulkJobRuns.Single().RunId);
        conn.Dispose();
    }

    [Fact]
    public async Task Run_changed_conflict_is_not_retried()
    {
        var (svc, faults, seed, conn, _) = NewSvc(_ => false, times: 0);
        await SeedJobOnRun1Async(seed);

        // The caller thinks the job is on run 2; it is on run 1.
        var (result, message) = await svc.AssignJobsToRunAsync(2, [new() { JobId = 10, FromRunId = 2 }]);

        Assert.Equal(("Failed", "Job has been moved by another user. Please refresh."), (result, message));
        Assert.Equal(1, faults.Transactions);
        conn.Dispose();
    }

    [Fact]
    public async Task Other_sql_errors_are_not_retried()
    {
        var (svc, faults, seed, conn, opts) = NewSvc(OnSave, times: int.MaxValue, number: 2627);
        await SeedJobOnRun1Async(seed);

        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => svc.AssignJobsToRunAsync(2, Move10From1()));

        Assert.Equal(2627, Assert.IsType<SqlException>(ex.InnerException).Number);
        Assert.Equal(1, faults.Thrown);
        Assert.Equal(1, faults.Transactions);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Equal(1, verify.TblBulkJobRuns.Single().RunId);
        conn.Dispose();
    }
}
