using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Run;

/// <summary>
/// CreateRunWithJobsAsync + AssignJobsToRunAsync run inside a real
/// transaction, so these use SQLite (InMemory ignores transactions). The
/// point of both methods is all-or-nothing, so each failure test checks a
/// fresh context to prove nothing was committed.
/// </summary>
public class RunServiceAssignTests
{
    private static readonly DateTime Date = new(2026, 9, 22);

    private static (RunService Svc, Core.Domain.DynamicDespatchDbContext Seed,
        System.Data.Common.DbConnection Conn, DbContextOptions<Core.Domain.DespatchContext> Opts)
        NewSvc()
    {
        var (opts, conn) = CockpitTestHarness.NewSqliteOptions();
        var seed = CockpitTestHarness.Context(opts);
        return (new RunService(CockpitTestHarness.Factory(opts)), seed, conn, opts);
    }

    private static TblBulkJob NewJob(int id, int? bulkRunId = null)
        => new()
        {
            BulkJobId = id, JobNumber = "J" + id, ClientId = 1, ClientCode = "C",
            BookDate = Date, BookTime = Date, FromAddress = "F", ToAddress = "T",
            BulkRunId = bulkRunId,
        };

    private static InsertOrUpdateRunRequest NewRun(params int[] jobIds)
        => new()
        {
            Name = "4410", Status = 0, DespatchDateTime = Date,
            Jobs = jobIds.Select(id => new RunJobDto { BulkJobId = id }).ToList(),
        };

    [Fact]
    public async Task CreateRunWithJobsAsync_CreatesRunAndAssignsEveryJob()
    {
        var (svc, seed, conn, opts) = NewSvc();
        seed.TblBulkJobs.AddRange(NewJob(1), NewJob(2), NewJob(3));
        await seed.SaveChangesAsync();

        var (result, message) = await svc.CreateRunWithJobsAsync(NewRun(1, 2, 3, 3));

        Assert.Equal("Success", result);
        var runId = int.Parse(message);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Single(verify.TblBulkRuns);
        Assert.All(verify.TblBulkJobs, j => Assert.Equal(runId, j.BulkRunId));
        Assert.Equal(3, verify.TblBulkJobRuns.Count(l => l.RunId == runId));
        conn.Dispose();
    }

    [Fact]
    public async Task CreateRunWithJobsAsync_MissingJobRollsBackRunInsert()
    {
        var (svc, seed, conn, opts) = NewSvc();
        seed.TblBulkJobs.Add(NewJob(1));
        await seed.SaveChangesAsync();

        var (result, _) = await svc.CreateRunWithJobsAsync(NewRun(1, 99));

        Assert.Equal("Failed", result);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Empty(verify.TblBulkRuns);
        Assert.Null(verify.TblBulkJobs.Single().BulkRunId);
        Assert.Empty(verify.TblBulkJobRuns);
        conn.Dispose();
    }

    [Fact]
    public async Task AssignJobsToRunAsync_MergeMovesJobsAndDeletesSource()
    {
        var (svc, seed, conn, opts) = NewSvc();
        seed.TblBulkRuns.AddRange(
            new TblBulkRun { Id = 1, Name = "Source", Status = 0, DespatchDateTime = Date },
            new TblBulkRun { Id = 2, Name = "Target", Status = 0, DespatchDateTime = Date });
        seed.TblBulkJobs.AddRange(NewJob(10, bulkRunId: 1), NewJob(11, bulkRunId: 1));
        seed.TblBulkJobRuns.AddRange(
            new TblBulkJobRun { RunId = 1, BulkJobId = 10 },
            new TblBulkJobRun { RunId = 1, BulkJobId = 11 });
        await seed.SaveChangesAsync();

        var (result, _) = await svc.AssignJobsToRunAsync(2, new List<AssignJobItem>
        {
            new() { JobId = 10, FromRunId = 1 },
            new() { JobId = 11, FromRunId = 1 },
        }, deleteRunId: 1);

        Assert.Equal("Success", result);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Equal(2, verify.TblBulkRuns.Single().Id);
        Assert.All(verify.TblBulkJobs, j => Assert.Equal(2, j.BulkRunId));
        Assert.All(verify.TblBulkJobRuns, l => Assert.Equal(2, l.RunId));
        Assert.Equal(2, verify.TblBulkJobRuns.Count());
        conn.Dispose();
    }

    [Fact]
    public async Task AssignJobsToRunAsync_StaleJobFailsWholeMergeAndKeepsSource()
    {
        var (svc, seed, conn, opts) = NewSvc();
        seed.TblBulkRuns.AddRange(
            new TblBulkRun { Id = 1, Name = "Source", Status = 0, DespatchDateTime = Date },
            new TblBulkRun { Id = 2, Name = "Target", Status = 0, DespatchDateTime = Date },
            new TblBulkRun { Id = 3, Name = "Elsewhere", Status = 0, DespatchDateTime = Date });
        seed.TblBulkJobs.AddRange(NewJob(10, bulkRunId: 1), NewJob(11, bulkRunId: 3));
        seed.TblBulkJobRuns.AddRange(
            new TblBulkJobRun { RunId = 1, BulkJobId = 10 },
            new TblBulkJobRun { RunId = 3, BulkJobId = 11 });
        await seed.SaveChangesAsync();

        // Job 11 was moved to run 3 by another operator; the caller still
        // thinks it's on run 1.
        var (result, _) = await svc.AssignJobsToRunAsync(2, new List<AssignJobItem>
        {
            new() { JobId = 10, FromRunId = 1 },
            new() { JobId = 11, FromRunId = 1 },
        }, deleteRunId: 1);

        Assert.Equal("Failed", result);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Equal(3, verify.TblBulkRuns.Count());
        Assert.Equal(1, verify.TblBulkJobs.Single(j => j.BulkJobId == 10).BulkRunId);
        Assert.Equal(1, verify.TblBulkJobRuns.Single(l => l.BulkJobId == 10).RunId);
        conn.Dispose();
    }
}
