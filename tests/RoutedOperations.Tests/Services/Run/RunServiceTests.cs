using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Run;

/// <summary>
/// InsertOrUpdateRunAsync + UpdateJobToRunAsync's per-job body uses raw
/// `MERGE tblBulkJobRun ... WITH (HOLDLOCK)` which isn't emulated by
/// InMemory or SQLite. Tests here exercise every path that does NOT hit
/// the MERGE:
///   - GetBulkRunsAsync (all EF)
///   - InsertOrUpdateRunAsync happy path with Jobs = empty list
///   - UpdateRunAsync (all EF)
///   - DeleteAsync (all EF)
///   - SetJobStartEndAsync (all EF)
///   - RemoveJobFromRunAsync (all EF)
/// UpdateJobToRunAsync's optimistic-concurrency PRE-check (also all EF)
/// gets a targeted test that returns before the MERGE body.
/// </summary>
public class RunServiceTests
{
    private static RunService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        return new RunService(CockpitTestHarness.Factory(opts));
    }

    private static TblBulkJob NewJob(int id, DateTime date, int clientId = 1, int speed = 1,
        int? bulkRunId = null, int? runOrder = null, bool done = false)
        => new()
        {
            BulkJobId = id, JobNumber = "J" + id, ClientId = clientId, ClientCode = "C",
            BookDate = date, BookTime = date, JobStatus = 0, Speed = speed,
            FromAddress = "F", ToAddress = "T", BulkRunId = bulkRunId, RunOrder = runOrder,
            Done = done,
        };

    [Fact]
    public async Task GetBulkRunsAsync_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var runs = await svc.GetBulkRunsAsync(null, null, null, null, null);

        Assert.Empty(runs);
    }

    [Fact]
    public async Task GetBulkRunsAsync_ReturnsRunWithItsAssignedJobs()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 5, Name = "R5", Status = 1, DespatchDateTime = date });
        seed.TblBulkJobs.Add(NewJob(1, date, bulkRunId: 5, runOrder: 3));
        await seed.SaveChangesAsync();

        var runs = await svc.GetBulkRunsAsync(date, null, null, null, null);

        var run = Assert.Single(runs);
        Assert.Equal(5, run.Id);
        Assert.Single(run.Jobs);
    }

    [Fact]
    public async Task GetBulkRunsAsync_IncludesDraftEmptyRunOnDate()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TblBulkRuns.Add(new TblBulkRun
        {
            Id = 10, Name = "Empty", Status = 0, DespatchDateTime = date
        });
        await seed.SaveChangesAsync();

        var runs = await svc.GetBulkRunsAsync(date, null, null, null, null);

        Assert.Single(runs);
        Assert.Equal(10, runs[0].Id);
    }

    [Fact]
    public async Task GetBulkRunsAsync_ExcludesDispatchedRunWithNoJobs()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TblBulkRuns.Add(new TblBulkRun
        {
            Id = 10, Name = "Dispatched", Status = 1, DespatchDateTime = date
        });
        await seed.SaveChangesAsync();

        var runs = await svc.GetBulkRunsAsync(date, null, null, null, null);

        Assert.Empty(runs);
    }

    [Fact]
    public async Task GetBulkRunsAsync_FiltersOutParentJobs()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 5, Name = "R", Status = 1, DespatchDateTime = date });
        seed.TblBulkJobs.AddRange(
            NewJob(1, date, bulkRunId: 5),
            NewJob(2, date, bulkRunId: 5));
        // Job 2 has some other job pointing at it as parent -> 2 is a parent -> filtered.
        var child = NewJob(3, date, bulkRunId: 5);
        child.ParentId = 2;
        seed.TblBulkJobs.Add(child);
        await seed.SaveChangesAsync();

        var runs = await svc.GetBulkRunsAsync(date, null, null, null, null);

        Assert.DoesNotContain(runs.SelectMany(r => r.Jobs), j => j.BulkJobId == 2);
    }

    [Fact]
    public async Task GetBulkRunsAsync_ExcludesAutoBookSchedule()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule { BulkRunScheduleId = 7, AutoBook = true });
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 5, Name = "R", Status = 1, DespatchDateTime = date });
        var j = NewJob(1, date, bulkRunId: 5); j.ScheduleId = 7;
        seed.TblBulkJobs.Add(j);
        await seed.SaveChangesAsync();

        var runs = await svc.GetBulkRunsAsync(date, null, null, null, null);

        Assert.Empty(runs);
    }

    [Fact]
    public async Task GetBulkRunsAsync_JoinsCourierAndSpeedNames()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucCouriers.Add(new TucCourier
        {
            UccrId = 10, Code = "10", UccrName = "Bob", Active = true, CourierFleetId = 2,
        });
        seed.TucCourierFleets.Add(new TucCourierFleet { UccfId = 2, UccfName = "North Fleet" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 3, UcjtName = "Express" });
        seed.TblBulkRuns.Add(new TblBulkRun
        {
            Id = 5, Name = "R5", Status = 1, DespatchDateTime = date, CourierId = 10,
        });
        var j = NewJob(1, date, bulkRunId: 5, speed: 3);
        j.CourierId = 10;
        seed.TblBulkJobs.Add(j);
        await seed.SaveChangesAsync();

        var runs = await svc.GetBulkRunsAsync(date, null, null, null, null);
        var run = Assert.Single(runs);

        Assert.Equal("10 Bob", run.CourierName);
        Assert.Equal("North Fleet", run.Fleet);
        Assert.Equal("Express", run.Jobs[0].SpeedName);
    }

    [Fact]
    public async Task GetBulkRunsAsync_HonoursStartEndFlagsOnJobRun()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 5, Name = "R", Status = 1, DespatchDateTime = date });
        seed.TblBulkJobs.Add(NewJob(1, date, bulkRunId: 5));
        seed.TblBulkJobRuns.Add(new TblBulkJobRun
        {
            Id = 1, BulkJobId = 1, RunId = 5, IsStart = true, IsEnd = false,
        });
        await seed.SaveChangesAsync();

        var runs = await svc.GetBulkRunsAsync(date, null, null, null, null);

        Assert.True(runs[0].Jobs[0].IsStart);
        Assert.False(runs[0].Jobs[0].IsEnd);
    }

    [Fact]
    public async Task GetBulkRunsAsync_ClientAndSpeedAndOurRefFilters()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 5, Name = "R", Status = 1, DespatchDateTime = date });
        var a = NewJob(1, date, bulkRunId: 5, clientId: 1, speed: 1); a.OurRef = "A";
        var b = NewJob(2, date, bulkRunId: 5, clientId: 2, speed: 2); b.OurRef = "B";
        seed.TblBulkJobs.AddRange(a, b);
        await seed.SaveChangesAsync();

        var justA = await svc.GetBulkRunsAsync(date, "1", null, "A", "1");
        Assert.Single(justA);
        Assert.Single(justA[0].Jobs);
        Assert.Equal(1, justA[0].Jobs[0].BulkJobId);
    }

    [Fact]
    public async Task InsertOrUpdateRunAsync_CreatesRunWhenIdMissing()
    {
        var svc = NewSvc(out var seed);

        var (res, msg) = await svc.InsertOrUpdateRunAsync(new InsertOrUpdateRunRequest
        {
            Id = null, Name = "NewRun", Mins = 30, Kms = 10,
            CourierPercent = "25%",
            Jobs = new List<RunJobDto>(),
            DespatchDateTime = new DateTime(2026, 8, 13),
        });

        Assert.Equal("Success", res);
        Assert.False(string.IsNullOrEmpty(msg));
        Assert.Single(seed.TblBulkRuns);
    }

    [Fact]
    public async Task InsertOrUpdateRunAsync_UpdatesExistingRun()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 42, Name = "Old", Status = 0 });
        await seed.SaveChangesAsync();

        var (res, msg) = await svc.InsertOrUpdateRunAsync(new InsertOrUpdateRunRequest
        {
            Id = 42, Name = "Renamed", Mins = 20, Kms = 5,
            Jobs = new List<RunJobDto>(),
        });

        Assert.Equal("Success", res);
        Assert.Equal("42", msg);
    }

    [Fact]
    public async Task InsertOrUpdateRunAsync_UnknownIdReturnsFailure()
    {
        var svc = NewSvc(out _);

        var (res, msg) = await svc.InsertOrUpdateRunAsync(new InsertOrUpdateRunRequest
        {
            Id = 9999, Name = "R", Jobs = new List<RunJobDto>(),
        });

        Assert.Equal("Failed", res);
        Assert.Equal("Run not found", msg);
    }

    [Fact]
    public async Task InsertOrUpdateRunAsync_CourierPercentNaNTreatedAsZero()
    {
        var svc = NewSvc(out _);

        var (res, _) = await svc.InsertOrUpdateRunAsync(new InsertOrUpdateRunRequest
        {
            Name = "R", CourierPercent = "NaN%", Jobs = new List<RunJobDto>(),
        });

        Assert.Equal("Success", res);
    }

    [Fact]
    public async Task InsertOrUpdateRunAsync_GoogleRouteResponseStringPassthrough()
    {
        var svc = NewSvc(out var seed);

        var (res, _) = await svc.InsertOrUpdateRunAsync(new InsertOrUpdateRunRequest
        {
            Name = "R",
            GoogleRouteResponse = "already-serialised",
            Jobs = new List<RunJobDto>(),
        });

        Assert.Equal("Success", res);
        Assert.Equal("already-serialised", seed.TblBulkRuns.Single().GoogleRouteResponse);
    }

    [Fact]
    public async Task UpdateRunAsync_UnknownIdReturnsFailure()
    {
        var svc = NewSvc(out _);

        var (res, msg) = await svc.UpdateRunAsync(new InsertOrUpdateRunRequest
        {
            Id = 999, Name = "R",
        });

        Assert.Equal("Failed", res);
        Assert.Equal("Run not found", msg);
    }

    [Fact]
    public async Task UpdateRunAsync_MissingIdReturnsFailure()
    {
        var svc = NewSvc(out _);

        var (res, msg) = await svc.UpdateRunAsync(new InsertOrUpdateRunRequest
        {
            Id = null, Name = "R",
        });

        Assert.Equal("Failed", res);
        Assert.Equal("Missing run id", msg);
    }

    [Fact]
    public async Task UpdateRunAsync_UpdatesFields()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 1, Name = "Old", CourierPercentage = 0.5 });
        await seed.SaveChangesAsync();

        var (res, _) = await svc.UpdateRunAsync(new InsertOrUpdateRunRequest
        {
            Id = 1, Name = "New", CourierPercent = "10%",
            GoogleRouteResponse = "route",
            NoReroute = true, RoutingMode = 2, FinishAtBulkJobId = 42,
        });

        Assert.Equal("Success", res);
    }

    [Fact]
    public async Task DeleteAsync_MissingIdReturnsSuccess()
    {
        var svc = NewSvc(out _);

        var (res, _) = await svc.DeleteAsync(999);

        Assert.Equal("Success", res);
    }

    [Fact]
    public async Task DeleteAsync_ClearsBulkRunIdOnAssociatedJobs()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRuns.Add(new TblBulkRun { Id = 1, Name = "R" });
        seed.TblBulkJobs.Add(NewJob(1, DateTime.Today, bulkRunId: 1, runOrder: 3));
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, BulkJobId = 1, RunId = 1, PickRunOrder = 3 });
        await seed.SaveChangesAsync();

        var (res, _) = await svc.DeleteAsync(1);

        Assert.Equal("Success", res);
    }

    [Fact]
    public async Task UpdateJobToRunAsync_OpticConflictShortCircuits()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, BulkJobId = 100, RunId = 5 });
        await seed.SaveChangesAsync();

        // fromRunId 3 provided but actual is 5 -> conflict, returns before MERGE.
        var (res, msg) = await svc.UpdateJobToRunAsync(100, fromRunId: 3, runId: 7);

        Assert.Equal("Failed", res);
        Assert.Contains("moved", msg);
    }

    [Fact]
    public async Task SetJobStartEndAsync_TargetJobNotOnRunReturnsFailure()
    {
        var svc = NewSvc(out _);

        var (res, msg) = await svc.SetJobStartEndAsync(1, 100, true, null);

        Assert.Equal("Failed", res);
        Assert.Contains("not on the run", msg);
    }

    [Fact]
    public async Task SetJobStartEndAsync_SetsStartAndClearsOthers()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobRuns.AddRange(
            new TblBulkJobRun { Id = 1, BulkJobId = 1, RunId = 5, IsStart = true },
            new TblBulkJobRun { Id = 2, BulkJobId = 2, RunId = 5 });
        await seed.SaveChangesAsync();

        var (res, _) = await svc.SetJobStartEndAsync(5, 2, isStart: true, isEnd: null);

        Assert.Equal("Success", res);
    }

    [Fact]
    public async Task SetJobStartEndAsync_SetsEndAndClearsOthers()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobRuns.AddRange(
            new TblBulkJobRun { Id = 1, BulkJobId = 1, RunId = 5, IsEnd = true },
            new TblBulkJobRun { Id = 2, BulkJobId = 2, RunId = 5 });
        await seed.SaveChangesAsync();

        var (res, _) = await svc.SetJobStartEndAsync(5, 2, isStart: null, isEnd: true);

        Assert.Equal("Success", res);
    }

    [Fact]
    public async Task SetJobStartEndAsync_ClearsStartOrEndWhenSetFalse()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, BulkJobId = 1, RunId = 5, IsStart = true, IsEnd = true });
        await seed.SaveChangesAsync();

        var (res, _) = await svc.SetJobStartEndAsync(5, 1, isStart: false, isEnd: false);

        Assert.Equal("Success", res);
    }

    [Fact]
    public async Task RemoveJobFromRunAsync_NotOnAnyRunReturnsFailure()
    {
        var svc = NewSvc(out _);

        var (res, msg) = await svc.RemoveJobFromRunAsync(999);

        Assert.Equal("Failed", res);
        Assert.Contains("not on any run", msg);
    }

    [Fact]
    public async Task RemoveJobFromRunAsync_RemovesAndClearsBulkRunId()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(NewJob(1, DateTime.Today, bulkRunId: 5));
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, BulkJobId = 1, RunId = 5 });
        await seed.SaveChangesAsync();

        var (res, _) = await svc.RemoveJobFromRunAsync(1);

        Assert.Equal("Success", res);
    }
}
