using Microsoft.AspNetCore.Mvc;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;
using RoutedOperations.Tests.Services;

namespace RoutedOperations.Tests.Controllers;

/// <summary>
/// #1018 C2: a Route Builder save hands back the run(s) it touched, as the
/// GET /api/runs projection shows them, so the cockpit can patch its lists and
/// take the busy overlay down at commit instead of after a full reload. Added
/// beside Result / Message so older callers see the same envelope. SQLite,
/// because assign-many and with-jobs run in a real transaction.
/// </summary>
public class RunsControllerTouchedRunsTests
{
    private static readonly DateTime Date = new(2026, 9, 22);

    private static (RunsController Ctl, Core.Domain.DynamicDespatchDbContext Seed, System.Data.Common.DbConnection Conn) NewCtl()
    {
        var (opts, conn) = CockpitTestHarness.NewSqliteOptions();
        var seed = CockpitTestHarness.Context(opts);
        var runService = new RunService(CockpitTestHarness.Factory(opts), RoutedOperations.Tests.Branches.BranchTestDoubles.Unrestricted());
        var cs = Substitute.For<IConnectionStringManager>();
        var ctl = new RunsController(runService, new RunCommitService(cs, ControllerTestHarness.Accessor()));
        ControllerTestHarness.AttachHttpContext(ctl);
        return (ctl, seed, conn);
    }

    private static TblBulkJob NewJob(int id, int? bulkRunId = null) => new()
    {
        BulkJobId = id, JobNumber = "J" + id, ClientId = 1, ClientCode = "C",
        BookDate = Date, BookTime = Date, FromAddress = "F", ToAddress = "T", BulkRunId = bulkRunId,
    };

    private static object Envelope(IActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        return ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value)!;
    }

    private static string? Result(object env) => env.GetType().GetProperty("Result")!.GetValue(env) as string;

    /// <summary>The touched runs, or null when the response carries none.</summary>
    private static List<RunDto>? Runs(object env) =>
        (env.GetType().GetProperty("Runs")?.GetValue(env) as IEnumerable<RunDto>)?.ToList();

    [Fact]
    public async Task Assign_many_returns_the_target_run_with_the_moved_job_and_the_source_run_without_it()
    {
        var (ctl, seed, conn) = NewCtl();
        seed.TblBulkRuns.AddRange(
            new TblBulkRun { Id = 10, Name = "Source", Status = 0, DespatchDateTime = Date },
            new TblBulkRun { Id = 20, Name = "Target", Status = 0, DespatchDateTime = Date });
        seed.TblBulkJobs.AddRange(NewJob(1, 10), NewJob(2, 10));
        seed.TblBulkJobRuns.AddRange(
            new TblBulkJobRun { BulkJobId = 1, RunId = 10, PickRunOrder = 0 },
            new TblBulkJobRun { BulkJobId = 2, RunId = 10, PickRunOrder = 1 });
        await seed.SaveChangesAsync();

        var env = Envelope(await ctl.AssignJobs(20, new AssignJobsToRunRequest
        {
            Jobs = [new AssignJobItem { JobId = 1, FromRunId = 10 }],
        }));

        Assert.Equal("Success", Result(env));
        var runs = Runs(env);
        Assert.NotNull(runs);
        Assert.Equal([1], runs!.Single(r => r.Id == 20).Jobs.Select(j => j.BulkJobId));
        Assert.Equal([2], runs.Single(r => r.Id == 10).Jobs.Select(j => j.BulkJobId));
        conn.Dispose();
    }

    [Fact]
    public async Task A_merge_does_not_return_the_run_it_deleted()
    {
        var (ctl, seed, conn) = NewCtl();
        seed.TblBulkRuns.AddRange(
            new TblBulkRun { Id = 10, Name = "Source", Status = 0, DespatchDateTime = Date },
            new TblBulkRun { Id = 20, Name = "Target", Status = 0, DespatchDateTime = Date });
        seed.TblBulkJobs.Add(NewJob(1, 10));
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { BulkJobId = 1, RunId = 10, PickRunOrder = 0 });
        await seed.SaveChangesAsync();

        var env = Envelope(await ctl.AssignJobs(20, new AssignJobsToRunRequest
        {
            Jobs = [new AssignJobItem { JobId = 1, FromRunId = 10 }], DeleteRunId = 10,
        }));

        Assert.Equal("Success", Result(env));
        Assert.Equal([20], Runs(env)!.Select(r => r.Id));
        conn.Dispose();
    }

    [Fact]
    public async Task Create_with_jobs_returns_the_new_run_holding_its_jobs()
    {
        var (ctl, seed, conn) = NewCtl();
        seed.TblBulkJobs.AddRange(NewJob(1), NewJob(2));
        await seed.SaveChangesAsync();

        var env = Envelope(await ctl.CreateWithJobs(new InsertOrUpdateRunRequest
        {
            Name = "4410", Status = 0, DespatchDateTime = Date,
            Jobs = [new RunJobDto { BulkJobId = 1 }, new RunJobDto { BulkJobId = 2 }],
        }));

        Assert.Equal("Success", Result(env));
        var run = Assert.Single(Runs(env)!);
        Assert.Equal("4410", run.Name);
        Assert.Equal([1, 2], run.Jobs.Select(j => j.BulkJobId).Order());
        conn.Dispose();
    }

    [Fact]
    public async Task Creating_an_empty_run_returns_it()
    {
        var (ctl, _, conn) = NewCtl();

        var env = Envelope(await ctl.InsertOrUpdate(new InsertOrUpdateRunRequest
        {
            Name = "Empty", Status = 0, DespatchDateTime = Date, Jobs = [],
        }));

        Assert.Equal("Success", Result(env));
        var run = Assert.Single(Runs(env)!);
        Assert.Equal("Empty", run.Name);
        Assert.Empty(run.Jobs);
        conn.Dispose();
    }

    // Courier assign and lock / unlock go through PUT /runs/{id}; the cockpit
    // patches the run from this instead of holding the screen for a reload.
    [Fact]
    public async Task Update_returns_the_run_with_its_new_status_and_jobs()
    {
        var (ctl, seed, conn) = NewCtl();
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 20, Name = "Target", Status = 0, DespatchDateTime = Date });
        seed.TblBulkJobs.Add(NewJob(1, 20));
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { BulkJobId = 1, RunId = 20, PickRunOrder = 0 });
        await seed.SaveChangesAsync();

        var env = Envelope(await ctl.Update(20, new InsertOrUpdateRunRequest
        {
            Name = "Target", Status = 1, DespatchDateTime = Date,
        }));

        Assert.Equal("Success", Result(env));
        var run = Assert.Single(Runs(env)!);
        Assert.Equal(20, run.Id);
        Assert.Equal(1, run.Status);
        Assert.Equal([1], run.Jobs.Select(j => j.BulkJobId));
        conn.Dispose();
    }

    [Fact]
    public async Task A_failed_update_returns_no_runs()
    {
        var (ctl, _, conn) = NewCtl();

        var env = Envelope(await ctl.Update(99, new InsertOrUpdateRunRequest
        {
            Name = "Missing", Status = 1, DespatchDateTime = Date,
        }));

        Assert.NotEqual("Success", Result(env));
        Assert.Null(Runs(env));
        conn.Dispose();
    }

    [Fact]
    public async Task A_failed_assign_returns_no_runs_so_the_cockpit_falls_back_to_a_reload()
    {
        var (ctl, seed, conn) = NewCtl();
        seed.TblBulkRuns.AddRange(
            new TblBulkRun { Id = 20, Name = "Other", Status = 0, DespatchDateTime = Date },
            new TblBulkRun { Id = 30, Name = "Target", Status = 0, DespatchDateTime = Date });
        seed.TblBulkJobs.Add(NewJob(1, 20));
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { BulkJobId = 1, RunId = 20, PickRunOrder = 0 });
        await seed.SaveChangesAsync();

        // Stale: the operator's screen says job 1 is on run 10; another
        // operator has since moved it to run 20.
        var env = Envelope(await ctl.AssignJobs(30, new AssignJobsToRunRequest
        {
            Jobs = [new AssignJobItem { JobId = 1, FromRunId = 10 }],
        }));

        Assert.Equal("Failed", Result(env));
        Assert.Null(Runs(env));
        conn.Dispose();
    }
}
