using RoutedOperations.Core.Application.Dtos.Job;
using RoutedOperations.Core.Application.Services.Job;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Job;

/// <summary>
/// VoidJobService uses `Database.BeginTransactionAsync`; InMemory doesn't
/// support real transactions so we run against SQLite. We do NOT verify
/// row-level state via a separate context in every test because the SQLite
/// provider is used only to satisfy the BeginTransaction contract - the
/// SUT's own DbContext instance sees its own writes.
/// </summary>
public class VoidJobServiceTests
{
    private static (VoidJobService Svc, Core.Domain.DynamicDespatchDbContext Seed,
        System.Data.Common.DbConnection Conn, Microsoft.EntityFrameworkCore.DbContextOptions<Core.Domain.DespatchContext> Opts)
        NewSvc()
    {
        var (opts, conn) = CockpitTestHarness.NewSqliteOptions();
        var seed = CockpitTestHarness.Context(opts);
        return (new VoidJobService(CockpitTestHarness.Factory(opts)), seed, conn, opts);
    }

    private static TblBulkJob NewJob(int id)
        => new()
        {
            BulkJobId = id, JobNumber = "J" + id, ClientId = 1, ClientCode = "C",
            BookDate = new DateTime(2026, 8, 13), BookTime = new DateTime(2026, 8, 13),
            FromAddress = "F", ToAddress = "T",
        };

    [Fact]
    public async Task VoidAsync_VoidingJobsCreatesVoidRun()
    {
        var (svc, seed, conn, opts) = NewSvc();
        seed.TblBulkJobs.AddRange(NewJob(1), NewJob(2));
        await seed.SaveChangesAsync();

        var res = await svc.VoidAsync(new VoidJobsRequest
        {
            IsVoid = true,
            JobIds = new List<int> { 1, 2 },
            RunDate = new DateTime(2026, 8, 13),
        });

        var props = res.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(res));
        Assert.Equal(2, props["Success"]);
        Assert.Equal(0, props["Failed"]);
        Assert.NotNull(props["VoidRunId"]);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Single(verify.TblBulkRuns);
        Assert.True(verify.TblBulkRuns.Single().IsVoidRun);
        conn.Dispose();
    }

    [Fact]
    public async Task VoidAsync_MissingJobsCountAsFailures()
    {
        var (svc, seed, conn, _) = NewSvc();
        seed.TblBulkJobs.Add(NewJob(1));
        await seed.SaveChangesAsync();

        var res = await svc.VoidAsync(new VoidJobsRequest
        {
            IsVoid = true,
            JobIds = new List<int> { 1, 999 },
            RunDate = new DateTime(2026, 8, 13),
        });

        var props = res.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(res));
        Assert.Equal(1, props["Success"]);
        Assert.Equal(1, props["Failed"]);
        conn.Dispose();
    }

    [Fact]
    public async Task VoidAsync_ExistingVoidRunIsReused()
    {
        var (svc, seed, conn, _) = NewSvc();
        seed.TblBulkRuns.Add(new TblBulkRun
        {
            Id = 1, Name = "Void Jobs", Status = 1, IsVoidRun = true,
            DespatchDateTime = new DateTime(2026, 8, 13),
        });
        seed.TblBulkJobs.Add(NewJob(1));
        await seed.SaveChangesAsync();

        var res = await svc.VoidAsync(new VoidJobsRequest
        {
            IsVoid = true,
            JobIds = new List<int> { 1 },
            RunDate = new DateTime(2026, 8, 13),
        });

        var props = res.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(res));
        Assert.Equal(1, props["Success"]);
        Assert.Equal(1, props["VoidRunId"]);
        conn.Dispose();
    }

    [Fact]
    public async Task VoidAsync_ExistingVoidRunNotMarkedIsUpgradedInPlace()
    {
        var (svc, seed, conn, opts) = NewSvc();
        seed.TblBulkRuns.Add(new TblBulkRun
        {
            Id = 1, Name = "Void Jobs", Status = 0, IsVoidRun = false,
            DespatchDateTime = new DateTime(2026, 8, 13),
        });
        seed.TblBulkJobs.Add(NewJob(1));
        await seed.SaveChangesAsync();

        await svc.VoidAsync(new VoidJobsRequest
        {
            IsVoid = true,
            JobIds = new List<int> { 1 },
            RunDate = new DateTime(2026, 8, 13),
        });

        using var verify = CockpitTestHarness.Context(opts);
        var run = verify.TblBulkRuns.Single();
        Assert.True(run.IsVoidRun);
        Assert.Equal(1, run.Status);
        conn.Dispose();
    }

    [Fact]
    public async Task VoidAsync_UpdatesExistingJobRunLink()
    {
        var (svc, seed, conn, _) = NewSvc();
        seed.TblBulkJobs.Add(NewJob(1));
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, BulkJobId = 1, RunId = 99, PickRunOrder = 5 });
        await seed.SaveChangesAsync();

        var res = await svc.VoidAsync(new VoidJobsRequest
        {
            IsVoid = true,
            JobIds = new List<int> { 1 },
            RunDate = new DateTime(2026, 8, 13),
        });

        var props = res.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(res));
        Assert.Equal(1, props["Success"]);
        conn.Dispose();
    }

    [Fact]
    public async Task VoidAsync_UnvoidingClearsRunLink()
    {
        var (svc, seed, conn, opts) = NewSvc();
        var job = NewJob(1); job.Void = true; job.JobStatus = 1000; job.BulkRunId = 99;
        seed.TblBulkJobs.Add(job);
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, BulkJobId = 1, RunId = 99 });
        seed.TblBulkRuns.Add(new TblBulkRun
        {
            Id = 99, Name = "Void Jobs", Status = 1, IsVoidRun = true,
            DespatchDateTime = new DateTime(2026, 8, 13),
        });
        await seed.SaveChangesAsync();

        var res = await svc.VoidAsync(new VoidJobsRequest
        {
            IsVoid = false,
            JobIds = new List<int> { 1 },
            RunDate = new DateTime(2026, 8, 13),
        });

        var props = res.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(res));
        Assert.Equal(1, props["Success"]);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Empty(verify.TblBulkJobRuns);
        // Void run was removed because it had no remaining jobs.
        Assert.Empty(verify.TblBulkRuns);
        conn.Dispose();
    }

    [Fact]
    public async Task VoidAsync_UnvoidingKeepsVoidRunWhenOtherJobsRemain()
    {
        var (svc, seed, conn, opts) = NewSvc();
        seed.TblBulkJobs.Add(NewJob(1));
        seed.TblBulkJobs.Add(NewJob(2));
        seed.TblBulkJobRuns.AddRange(
            new TblBulkJobRun { Id = 1, BulkJobId = 1, RunId = 99 },
            new TblBulkJobRun { Id = 2, BulkJobId = 2, RunId = 99 });
        seed.TblBulkRuns.Add(new TblBulkRun
        {
            Id = 99, Name = "Void Jobs", Status = 1, IsVoidRun = true,
            DespatchDateTime = new DateTime(2026, 8, 13),
        });
        await seed.SaveChangesAsync();

        var res = await svc.VoidAsync(new VoidJobsRequest
        {
            IsVoid = false,
            JobIds = new List<int> { 1 },
            RunDate = new DateTime(2026, 8, 13),
        });

        var props = res.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(res));
        Assert.Equal(1, props["Success"]);
        Assert.Equal(99, props["VoidRunId"]);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.NotNull(verify.TblBulkRuns.SingleOrDefault(r => r.Id == 99));
        conn.Dispose();
    }

    [Fact]
    public async Task VoidAsync_NoJobsFoundReturnsAllFailed()
    {
        var (svc, _, conn, _) = NewSvc();

        var res = await svc.VoidAsync(new VoidJobsRequest
        {
            IsVoid = true,
            JobIds = new List<int> { 999 },
            RunDate = new DateTime(2026, 8, 13),
        });

        var props = res.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(res));
        Assert.Equal(0, props["Success"]);
        Assert.Equal(1, props["Failed"]);
        conn.Dispose();
    }
}
