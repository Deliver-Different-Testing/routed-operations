using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.Run;

/// <summary>
/// #1018 C4: two operators building runs on the same day must not block each
/// other. These drive the real RunService.AssignJobsToRunAsync against a real
/// SQL Server, two sessions at once. Session A is held at its commit by an
/// interceptor while session B runs; both commits are then suppressed, so the
/// transactions roll back on dispose and nothing is written.
///
/// Opt-in and skipped by default (CI has no SQL Server), same as
/// ZoneGroupLocksSqlServerTests. Point it at a LOCAL database only:
///   RO_SQLSERVER_TEST_CONN    e.g. Server=localhost\MSSQL;Database=Despatch_Urgent_Staging;Trusted_Connection=True;TrustServerCertificate=True
/// </summary>
public class RunAssignConcurrencySqlServerTests
{
    private static readonly TimeSpan BlockedAfter = TimeSpan.FromSeconds(5);

    private static string Conn()
    {
        var conn = Environment.GetEnvironmentVariable("RO_SQLSERVER_TEST_CONN");
        if (string.IsNullOrWhiteSpace(conn))
            Assert.Skip("RO_SQLSERVER_TEST_CONN is not set; this test needs a local SQL Server.");
        return conn!;
    }

    /// <summary>Holds the commit until Release completes, then suppresses it,
    /// so the service's transaction rolls back when it is disposed.</summary>
    private sealed class HoldThenRollback(Task release) : DbTransactionInterceptor
    {
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override async ValueTask<InterceptionResult> TransactionCommittingAsync(
            DbTransaction transaction, TransactionEventData eventData, InterceptionResult result,
            CancellationToken cancellationToken = default)
        {
            Reached.TrySetResult();
            await release;
            return InterceptionResult.Suppress();
        }
    }

    private static RunService Service(string conn, HoldThenRollback interceptor)
    {
        var opts = new DbContextOptionsBuilder<DespatchContext>()
            .UseSqlServer(conn)
            .AddInterceptors(interceptor)
            .Options;
        return new RunService(CockpitTestHarness.Factory(opts), RoutedOperations.Tests.Branches.BranchTestDoubles.Unrestricted());
    }

    private static DynamicDespatchDbContext Plain(string conn) =>
        new(new DbContextOptionsBuilder<DespatchContext>().UseSqlServer(conn).Options);

    /// <summary>Two jobs with consecutive ids, booked the same day, neither on
    /// a run, plus two run ids. Consecutive unlinked ids share one gap in the
    /// tblBulkJobRun BulkJobID index, which is what a Serializable range lock
    /// covers. The two must be in different families: the legacy
    /// tblBulkJob_Update trigger has a child's update read its family parent's
    /// row, so two assigns inside one family rightly queue (local US first
    /// picked parent 1233 and its child 1234). Read at run time so the test
    /// follows the local data.</summary>
    private static async Task<(int Job1, int Job2, int Run1, int Run2)> PickRowsAsync(string conn)
    {
        await using var db = Plain(conn);
        var jobs = await db.Database.SqlQueryRaw<int>(@"
            SELECT TOP 1 a.BulkJobID AS [Value]
            FROM dbo.tblBulkJob a
            JOIN dbo.tblBulkJob b ON b.BulkJobID = a.BulkJobID + 1
             AND CAST(b.BookDate AS date) = CAST(a.BookDate AS date)
            WHERE NOT EXISTS (SELECT 1 FROM dbo.tblBulkJobRun l WHERE l.BulkJobID IN (a.BulkJobID, b.BulkJobID))
              AND COALESCE(a.RootParentID, a.BulkJobID) <> COALESCE(b.RootParentID, b.BulkJobID)
              AND COALESCE(a.ParentID, a.BulkJobID) <> COALESCE(b.ParentID, b.BulkJobID)
            ORDER BY a.BulkJobID DESC").ToListAsync();
        var runs = await db.Database.SqlQueryRaw<int>(
            "SELECT TOP 2 ID AS [Value] FROM dbo.tblBulkRun ORDER BY ID DESC").ToListAsync();
        if (jobs.Count == 0 || runs.Count < 2) Assert.Skip("No two adjacent unassigned jobs and two runs in this database.");
        return (jobs[0], jobs[0] + 1, runs[0], runs[1]);
    }

    private static async Task AssertNothingWrittenAsync(string conn, params int[] jobIds)
    {
        await using var db = Plain(conn);
        var links = await db.TblBulkJobRuns.AsNoTracking()
            .CountAsync(l => l.BulkJobId.HasValue && jobIds.Contains(l.BulkJobId.Value), TestContext.Current.CancellationToken);
        Assert.Equal(0, links);
        var onRuns = await db.TblBulkJobs.AsNoTracking()
            .CountAsync(j => jobIds.Contains(j.BulkJobId) && j.BulkRunId != null, TestContext.Current.CancellationToken);
        Assert.Equal(0, onRuns);
    }

    /// <summary>What is waiting right now, for the failure message.</summary>
    private static async Task<string> BlockedStatementsAsync(string conn)
    {
        await using var db = Plain(conn);
        var rows = await db.Database.SqlQueryRaw<string>(@"
            SELECT CONCAT(r.wait_type, ' ', r.wait_resource, ' :: ', LEFT(t.text, 400)) AS [Value]
            FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
            WHERE r.blocking_session_id <> 0").ToListAsync();
        return rows.Count == 0 ? "(nothing found)" : string.Join(" | ", rows);
    }

    [Fact]
    public async Task Two_assigns_of_different_jobs_to_different_runs_on_the_same_day_do_not_block_each_other()
    {
        var conn = Conn();
        var (job1, job2, run1, run2) = await PickRowsAsync(conn);

        var releaseA = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var holdA = new HoldThenRollback(releaseA.Task);
        var a = Service(conn, holdA);
        var b = Service(conn, new HoldThenRollback(Task.CompletedTask));

        var aTask = a.AssignJobsToRunAsync(run1, new List<AssignJobItem> { new() { JobId = job1 } });
        await holdA.Reached.Task.WaitAsync(TimeSpan.FromSeconds(30), TestContext.Current.CancellationToken);

        // A now holds every lock it will hold until its commit.
        var bTask = b.AssignJobsToRunAsync(run2, new List<AssignJobItem> { new() { JobId = job2 } });
        var first = await Task.WhenAny(bTask, Task.Delay(BlockedAfter, TestContext.Current.CancellationToken));
        var bFinishedWhileAHeldItsLocks = first == bTask;
        var blockedOn = bFinishedWhileAHeldItsLocks ? "" : await BlockedStatementsAsync(conn);

        releaseA.TrySetResult();
        var aResult = await aTask;
        var bResult = await bTask;

        Assert.True(bFinishedWhileAHeldItsLocks,
            $"Operator B (job {job2} -> run {run2}) waited on operator A (job {job1} -> run {run1}) for more than {BlockedAfter.TotalSeconds}s. Blocked on: {blockedOn}");
        Assert.Equal("Success", aResult.Result);
        Assert.Equal("Success", bResult.Result);
        await AssertNothingWrittenAsync(conn, job1, job2);
    }

    [Fact]
    public async Task Two_assigns_of_the_same_job_still_queue_so_the_second_reads_the_first_ones_result()
    {
        // The fromRunId check is only as good as what it reads: B must not
        // read the job's run link until A has finished with it. With A held
        // at its commit, B has to wait. (The conflict rule itself is
        // RunServiceAssignTests.AssignJobsToRunAsync_StaleJobFailsWholeMergeAndKeepsSource.)
        var conn = Conn();
        var (job1, _, run1, run2) = await PickRowsAsync(conn);

        var releaseA = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var holdA = new HoldThenRollback(releaseA.Task);
        var a = Service(conn, holdA);
        var b = Service(conn, new HoldThenRollback(Task.CompletedTask));

        var aTask = a.AssignJobsToRunAsync(run1, new List<AssignJobItem> { new() { JobId = job1 } });
        await holdA.Reached.Task.WaitAsync(TimeSpan.FromSeconds(30), TestContext.Current.CancellationToken);

        var bTask = b.AssignJobsToRunAsync(run2, new List<AssignJobItem> { new() { JobId = job1 } });
        var first = await Task.WhenAny(bTask, Task.Delay(BlockedAfter, TestContext.Current.CancellationToken));
        var bWaited = first != bTask;

        releaseA.TrySetResult();
        await aTask;
        await bTask;

        Assert.True(bWaited, "B read job " + job1 + " while A still held it");
        await AssertNothingWrittenAsync(conn, job1);
    }
}
