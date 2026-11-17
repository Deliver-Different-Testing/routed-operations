using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Job;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services.Job;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Infrastructure;
using RoutedOperations.Tests.Services;

namespace RoutedOperations.Tests.Branches;

// Review fixes for the branch scoping of Route Viewer actions, Route Builder writes, dispatch, void and events. Each test fails
// without the matching fix. The Melbourne user is also an NP "admin" (all tenant staff are), which is what hid the original gap.
public class ReviewFixesBranchTests
{
    private const int Sydney = 1;
    private const int Melbourne = 2;
    private static readonly DateTime Day = new(2026, 11, 16);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private readonly DbContextOptions<DespatchContext> _options = CockpitTestHarness.NewInMemoryOptions();

    private IDbContextFactory<DynamicDespatchDbContext> Factory() => CockpitTestHarness.Factory(_options);

    private async Task Seed(params object[] rows)
    {
        await using var context = CockpitTestHarness.Context(_options);
        context.AddRange(rows);
        await context.SaveChangesAsync(Ct);
    }

    private static BranchScopeGuard MelbourneGuard(IDbContextFactory<DynamicDespatchDbContext> factory)
    {
        var resolver = Substitute.For<IBranchScopeResolver>();
        resolver.Resolve().Returns(BranchScope.Restricted([Melbourne]));
        return new BranchScopeGuard(resolver, factory);
    }

    private BranchScopeGuard MelbourneGuard() => MelbourneGuard(Factory());

    private static INpScopeResolver AdminScope()
    {
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        return resolver;
    }

    private static object[] WorldRows() =>
    [
        new TblBranch { BranchId = Sydney, IsDefault = true, Active = true, SiteId = 43 },
        new TblBranch { BranchId = Melbourne, IsDefault = false, Active = true, SiteId = 44 },
        new TucClient { UcclId = 10, BranchId = Sydney, ClientTypeId = 2, UcclActive = true, UcclName = "Sydney Co" },
        new TucClient { UcclId = 20, BranchId = Melbourne, ClientTypeId = 2, UcclActive = true, UcclName = "Melbourne Co" },
        new TucCourier { UccrId = 100, UccrName = "Syd", UccrSurname = "Driver", Code = "S1", Active = true, BranchId = Sydney },
        new TucCourier { UccrId = 200, UccrName = "Mel", UccrSurname = "Driver", Code = "M1", Active = true, BranchId = Melbourne },
        new TucJob { UcjbId = 1, UcjbNumber = "SYD1", UcjbClientId = 10 },
        new TucJob { UcjbId = 2, UcjbNumber = "MEL1", UcjbClientId = 20 },
    ];

    // Clients 10 Sydney / 20 Melbourne; couriers 100 Sydney / 200 Melbourne; tucJobs 1 (Sydney) and 2 (Melbourne).
    private Task World() => Seed(WorldRows());

    private static TblBulkJob BulkJob(int id, int client, int? jobId = null, int? run = null) => new()
    {
        BulkJobId = id, JobNumber = $"J{id}", BookDate = Day, BookTime = Day, ClientId = client, ClientCode = $"C{client}",
        Speed = 1, FromAddress = "F", ToAddress = "T", JobId = jobId, BulkRunId = run,
    };

    private static TblBulkJobRun OnRun(int run, int job) => new() { RunId = run, BulkJobId = job };

    // ---- 1. Route Viewer job actions: the branch guard applies although the caller is an NP "admin" ----

    private RouteViewerJobActionService JobActions()
    {
        var npGuard = new NpScopeGuard(AdminScope(), Factory());
        INpScopeGuard combined = new NpAndBranchScopeGuard(npGuard, MelbourneGuard());
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext());
        return new RouteViewerJobActionService(Factory(), AdminScope(), combined, accessor, NullLogger<RouteViewerJobActionService>.Instance);
    }

    [Fact]
    public async Task JobActions_OnASydneyJob_AreDeniedForAMelbourneUser_EvenAsAnNpAdmin()
    {
        await World();
        await Seed(BulkJob(31, 10, jobId: 1));
        var svc = JobActions();

        await Assert.ThrowsAsync<BranchScopeException>(() => svc.ActivateAsync(1));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.PickupAsync(1));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.CompleteAsync(1, "pod", null));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.TransferJobAsync(1, "S1", "M1"));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.SendSmsAsync(1, "021", "hi"));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.AddJobNoteAsync(1, "n"));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.CancelJobsAsync([31]));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.MoveJobsBackToRunBuilderAsync([31], Day, 1, false));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.AddBulkJobNoteAsync(31, "n"));
    }

    [Fact]
    public async Task JobActions_OnTheirOwnJob_GoPastTheGuard()
    {
        await World();

        // The stored procedure can't run on InMemory; reaching it means the guard let the job through.
        var ex = await Record.ExceptionAsync(() => JobActions().ActivateAsync(2));

        Assert.NotNull(ex);
        Assert.IsNotType<BranchScopeException>(ex);
    }

    [Fact]
    public async Task SendSmsToRun_OnARunOutsideTheCallersBranches_IsDenied()
    {
        await World();
        await Seed(new TblBulkRun { Id = 9, CourierId = 100 }, BulkJob(31, 10, jobId: 1, run: 9), OnRun(9, 31));

        await Assert.ThrowsAsync<BranchScopeException>(() => JobActions().SendSmsToRunAsync(9, "hi"));
    }

    // ---- 2 and 6. Route Builder writes: jobs pulled onto a run, and the run they come from ----

    private RunService Runs() => new(Factory(), MelbourneGuard());

    [Fact]
    public async Task LockRun_WithAForeignJobAndNoRunId_IsRefused_AndTheJobStaysPut()
    {
        await World();
        await Seed(new TblBulkRun { Id = 3, CourierId = 100 }, BulkJob(31, 10, run: 3), OnRun(3, 31), BulkJob(51, 20));
        var request = new InsertOrUpdateRunRequest { Name = "Sneaky", Jobs = [new RunJobDto { BulkJobId = 31 }] };

        var result = await Runs().InsertOrUpdateRunAsync(request);

        Assert.Equal("Failed", result.Result);
        await using var check = CockpitTestHarness.Context(_options);
        Assert.Equal(3, (await check.TblBulkJobs.FindAsync([31], Ct))!.BulkRunId);
        Assert.Equal(1, await check.TblBulkRuns.CountAsync(Ct));   // no new run was created either
    }

    [Fact]
    public async Task LockRun_WithTheirOwnUnbuiltJob_GoesPastTheGuard()
    {
        await World();
        await Seed(BulkJob(51, 20));

        var ex = await Record.ExceptionAsync(() => Runs().InsertOrUpdateRunAsync(
            new InsertOrUpdateRunRequest { Name = "Mine", Jobs = [new RunJobDto { BulkJobId = 51 }] }));

        // The raw MERGE can't run on InMemory; reaching it means the guard let the job through.
        Assert.NotNull(ex);
    }

    // One rule everywhere: a job is the caller's to act on when it is visible, or it is on a run whose courier is theirs. Where it
    // sits (a mixed run with no courier, a Sydney courier's run) does not matter for a job that is visible.
    [Fact]
    public async Task MovingOrRemoving_AJobTheyCanSee_IsAllowedWhateverRunItIsOn_AndOneTheyCannotIsRefused()
    {
        await World();
        await Seed(
            new TblBulkRun { Id = 2, CourierId = null }, new TblBulkRun { Id = 5, CourierId = 200 },
            BulkJob(21, 20, run: 2), OnRun(2, 21),    // run 2: no courier, a Melbourne job and a Sydney job
            BulkJob(22, 10, run: 2), OnRun(2, 22));
        var svc = Runs();

        Assert.Equal("Failed", (await svc.UpdateJobToRunAsync(22, null, 5)).Result);
        Assert.Equal("Failed", (await svc.RemoveJobFromRunAsync(22)).Result);
        Assert.Equal("Failed", (await svc.AssignJobsToRunAsync(5, [new() { JobId = 22 }])).Result);
        Assert.Equal("Success", (await svc.RemoveJobFromRunAsync(21)).Result);   // their own client's job comes off the mixed run
    }

    // ---- review 2, finding 1: a pointer to a run that no longer exists must not open the guard ----

    [Fact]
    public async Task AJobWithAStaleRunPointer_StandsOnItsOwnVisibility_NotOnTheMissingRun()
    {
        await World();
        await Seed(
            BulkJob(31, 10, jobId: 1), OnRun(99, 31),        // Sydney job, junction row points at run 99 which does not exist
            BulkJob(32, 10, jobId: 1, run: 98),               // Sydney job, tblBulkJob.BulkRunId points at run 98 which does not exist
            BulkJob(51, 20, run: 97));                         // their own client's job with a stale pointer: still theirs
        var svc = Runs();

        Assert.Equal("Failed", (await svc.RemoveJobFromRunAsync(31)).Result);
        Assert.Equal("Failed", (await svc.RemoveJobFromRunAsync(32)).Result);
        Assert.Equal(new[] { 51 }, (await MelbourneGuard().ActionableBulkJobIdsAsync([31, 32, 51])).Order().ToArray());
        await Assert.ThrowsAsync<BranchScopeException>(() => MelbourneGuard().EnsureBulkJobInScopeAsync(31));
    }

    // ---- review 2, finding 2: Route Viewer bulk-job actions use the same rule ----

    [Fact]
    public async Task RouteViewerBulkActions_AForeignJobOnTheirCouriersRun_IsAllowed_OnASydneyCouriersRun_IsDenied()
    {
        await World();
        await Seed(
            new TblBulkRun { Id = 1, CourierId = 200 }, new TblBulkRun { Id = 3, CourierId = 100 },
            BulkJob(12, 10, jobId: 1, run: 1), OnRun(1, 12),   // Sydney job on Melbourne's run
            BulkJob(31, 10, jobId: 1, run: 3), OnRun(3, 31));  // Sydney job on Sydney's run
        var svc = JobActions();

        await Assert.ThrowsAsync<BranchScopeException>(() => svc.AddBulkJobNoteAsync(31, "n"));
        await Assert.ThrowsAsync<BranchScopeException>(() => svc.CancelJobsAsync([12, 31]));
        var ex = await Record.ExceptionAsync(() => svc.AddBulkJobNoteAsync(12, "n"));   // reaches the stored procedure: the guard let it through
        Assert.NotNull(ex);
        Assert.IsNotType<BranchScopeException>(ex);
    }

    // ---- review 2, finding 5: one definition of "the jobs on a run" ----

    [Fact]
    public async Task ARunLinkedOnlyByBulkRunId_IsJudgedOnItsRealJobs()
    {
        await World();
        await Seed(
            new TblBulkRun { Id = 6, CourierId = null }, BulkJob(41, 20, run: 6),                    // Melbourne job, no link row
            new TblBulkRun { Id = 7, CourierId = null }, BulkJob(42, 10, run: 7), BulkJob(43, 20, run: 7));   // Sydney + Melbourne
        var guard = MelbourneGuard();

        Assert.True(await guard.IsRunFullyVisibleAsync(6));
        Assert.False(await guard.IsRunFullyVisibleAsync(7));
        Assert.Contains(6, await guard.VisibleRunIdsAsync([6, 7]));
        Assert.Equal("Deleted", (await Runs().DeleteAsync(6)).Message);   // theirs, so they can delete it
        Assert.Equal("Failed", (await Runs().DeleteAsync(7)).Result);
    }

    [Fact]
    public async Task ALinkRowWins_OverAStaleBulkRunId()
    {
        await World();
        // The job is linked to run 1 (Melbourne's courier); its BulkRunId still says run 3 (a Sydney courier's run).
        await Seed(
            new TblBulkRun { Id = 1, CourierId = 200 }, new TblBulkRun { Id = 3, CourierId = 100 },
            BulkJob(12, 10, jobId: 1, run: 3), OnRun(1, 12));

        Assert.Equal(new[] { 12 }, (await MelbourneGuard().ActionableBulkJobIdsAsync([12])).ToArray());
        Assert.False(await MelbourneGuard().IsRunFullyVisibleAsync(3));   // run 3 is not judged on a job that is linked elsewhere
    }

    // ---- review 2, finding 3: the courier on a write must be the caller's ----

    [Fact]
    public async Task RunWrites_WithACourierOutsideTheCallersBranches_AreRefused()
    {
        await World();
        await Seed(new TblBulkRun { Id = 4, CourierId = null }, new TblBulkRun { Id = 8, CourierId = 100 }, BulkJob(51, 20, run: 8), OnRun(8, 51));
        var sydneyCourier = new CourierRefDto { CourierId = 100 };

        Assert.Equal("Failed", (await Runs().InsertOrUpdateRunAsync(new InsertOrUpdateRunRequest { Name = "N", Courier = sydneyCourier })).Result);
        Assert.Equal("Failed", (await Runs().InsertOrUpdateRunAsync(new InsertOrUpdateRunRequest { Id = 4, Name = "N", Courier = sydneyCourier })).Result);
        Assert.Equal("Failed", (await Runs().UpdateRunAsync(new InsertOrUpdateRunRequest { Id = 4, Name = "N", Courier = sydneyCourier })).Result);
        await using (var check = CockpitTestHarness.Context(_options))
        {
            Assert.Null((await check.TblBulkRuns.FindAsync([4], Ct))!.CourierId);
            Assert.Equal(1, await check.TblBulkRuns.CountAsync(r => r.Id == 4, Ct));
        }

        // Their own courier is fine, and so is keeping the courier a run already has (run 8: a Sydney courier on all-Melbourne jobs).
        Assert.Equal("Success", (await Runs().UpdateRunAsync(new InsertOrUpdateRunRequest { Id = 4, Name = "N", Courier = new CourierRefDto { CourierId = 200 } })).Result);
        Assert.Equal("Success", (await Runs().UpdateRunAsync(new InsertOrUpdateRunRequest { Id = 8, Name = "Renamed", Courier = sydneyCourier })).Result);
    }

    [Fact]
    public async Task Dispatch_WithACourierOutsideTheCallersBranches_IsRefusedBeforeTheTenantDatabaseIsReached()
    {
        await World();
        await Seed(BulkJob(51, 20));   // their own client's job
        var mgr = Substitute.For<IConnectionStringManager>();
        var svc = new RunCommitService(mgr, Substitute.For<IHttpContextAccessor>(), MelbourneGuard());

        var jobs = await svc.DispatchJobsAsync(new DispatchJobsRequest { JobIds = [51], CourierId = 100 });
        var runs = await svc.DispatchAsync([new InsertOrUpdateRunRequest
            { Name = "R", Courier = new CourierRefDto { CourierId = 100 }, Jobs = [new RunJobDto { BulkJobId = 51 }] }]);

        Assert.Equal("Courier not found", Assert.Single(jobs).Message);
        Assert.Equal("Courier not found", Assert.Single(runs).Message);
        await mgr.DidNotReceiveWithAnyArgs().GetConnectionStringAsync(default!);
    }

    // ---- informational: send-sms-run applies the NP run check to a real NP ----

    [Fact]
    public async Task SendSmsToRun_ForAnNp_IsDenied_WhenTheRunHoldsAnotherNpsJob()
    {
        await Seed(
            new TucJob { UcjbId = 1, UcjbNumber = "A", NpAgentId = 6 },
            new TblBulkRun { Id = 9 }, BulkJob(31, 10, jobId: 1, run: 9), OnRun(9, 31));
        var np = Substitute.For<INpScopeResolver>();
        np.ResolveAsync().Returns(new NpScope(false, 5));
        INpScopeGuard combined = new NpAndBranchScopeGuard(new NpScopeGuard(np, Factory()), BranchTestDoubles.Unrestricted());
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext());
        var svc = new RouteViewerJobActionService(Factory(), np, combined, accessor, NullLogger<RouteViewerJobActionService>.Instance);

        await Assert.ThrowsAsync<NpLabelScopeException>(() => svc.SendSmsToRunAsync(9, "hi"));
    }

    [Fact]
    public async Task OnARunWhoseCourierIsTheirs_EveryJobIsMovable_IncludingAForeignBranchJob()
    {
        await World();
        await Seed(new TblBulkRun { Id = 1, CourierId = 200 }, BulkJob(12, 10, run: 1), OnRun(1, 12));   // Sydney job on Melbourne's run

        var result = await Runs().RemoveJobFromRunAsync(12);

        Assert.Equal("Success", result.Result);
    }

    // ---- 3. Dispatch and void ----

    [Fact]
    public async Task Dispatch_OfJobsOutsideTheCallersBranches_IsRefusedBeforeTheTenantDatabaseIsReached()
    {
        await World();
        await Seed(BulkJob(31, 10, jobId: 1));
        var mgr = Substitute.For<IConnectionStringManager>();   // never asked: nothing of theirs to send
        var svc = new RunCommitService(mgr, Substitute.For<IHttpContextAccessor>(), MelbourneGuard());

        var jobs = await svc.DispatchJobsAsync(new DispatchJobsRequest { JobIds = [31] });
        var runs = await svc.DispatchAsync([new InsertOrUpdateRunRequest { Name = "R", Jobs = [new RunJobDto { BulkJobId = 31 }] }]);

        Assert.All(jobs.Concat(runs), r => Assert.Equal("Failed", r.Result));
        Assert.Single(jobs);
        Assert.Single(runs);
        await mgr.DidNotReceiveWithAnyArgs().GetConnectionStringAsync(default!);
    }

    [Fact]
    public async Task ActionableBulkJobIds_AreTheVisibleOnes_PlusJobsOnARunWhoseCourierIsTheirs()
    {
        await World();
        await Seed(
            new TblBulkRun { Id = 1, CourierId = 200 }, new TblBulkRun { Id = 3, CourierId = 100 },
            BulkJob(12, 10, run: 1), OnRun(1, 12),    // Sydney job on Melbourne's run: actionable
            BulkJob(31, 10, run: 3), OnRun(3, 31),    // Sydney job on Sydney's run: not
            BulkJob(51, 20));                          // their own client's job: visible

        var ids = await MelbourneGuard().ActionableBulkJobIdsAsync([12, 31, 51]);

        Assert.Equal(new[] { 12, 51 }, ids.Order().ToArray());
    }

    [Fact]
    public async Task Void_OnlyVoidsTheCallersJobs_TheRestReadAsNotFound()
    {
        var (opts, conn) = CockpitTestHarness.NewSqliteOptions();
        var factory = CockpitTestHarness.Factory(opts);
        await using (var seed = CockpitTestHarness.Context(opts))
        {
            seed.AddRange(WorldRows().Where(r => r is TblBranch or TucClient));
            seed.AddRange(BulkJob(31, 10), BulkJob(51, 20));
            await seed.SaveChangesAsync(Ct);
        }
        var svc = new VoidJobService(factory, MelbourneGuard(factory));

        await svc.VoidAsync(new VoidJobsRequest { JobIds = [31, 51], IsVoid = true, RunDate = Day });

        await using var check = CockpitTestHarness.Context(opts);
        Assert.False((await check.TblBulkJobs.FindAsync([31], Ct))!.Void);   // the Sydney job stays live
        Assert.True((await check.TblBulkJobs.FindAsync([51], Ct))!.Void);
        conn.Dispose();
    }

    // ---- 4. Run-level refusals are a 403, not a 500 ----

    [Fact]
    public async Task RunLevelActions_OutsideTheCallersBranches_Return403()
    {
        await World();
        await Seed(new TblBulkRun { Id = 7, CourierId = 100 });
        var assignment = new RouteViewerAssignmentService(Factory(), AdminScope(), Substitute.For<INpScopeGuard>(), MelbourneGuard(),
            NullLogger<RouteViewerAssignmentService>.Instance);
        var controller = new RunViewerAssignmentController(assignment);
        RoutedOperations.Tests.Controllers.ControllerTestHarness.AttachHttpContext(controller);

        var results = new[]
        {
            await controller.PreAssignRun(new PreAssignRunRequest { RunId = 7, FromCourierCode = "S1", ToCourierCode = "M1" }),
            await controller.TransferRun(new TransferRunRequest { RunId = 7, FromCourierCode = "S1", ToCourierCode = "M1" }),
            await controller.ReleaseRun(new ReleaseRunRequest { RunId = 7, CourierCode = "S1" }),
            await controller.UnAssignRun(new UnAssignRunRequest { RunId = 7, CourierCode = "S1" }),
            await controller.TransferOriginalRunOrder(new TransferOriginalRunOrderRequest { RunId = 7, ToCourierCode = "M1" }),
        };

        Assert.All(results, r => Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(r).StatusCode));
    }

    // ---- 5. Events ----

    private RouteViewerEventService Events() =>
        new(Factory(), AdminScope(), MelbourneGuard(), NullLogger<RouteViewerEventService>.Instance);

    [Fact]
    public async Task EventWrites_OnAnotherBranchsEvent_AreRefused_AndNothingChanges()
    {
        await World();
        await Seed(BulkJob(31, 10, jobId: 1),
            new TblBulkEvent { BulkEventId = 5, BulkJobId = 31, Notes = "original", Created = Day, EventDate = DateOnly.FromDateTime(Day) });
        var svc = Events();

        Assert.False(await svc.CloseEventAsync(5, "mel"));
        Assert.False(await svc.AddEventReplyAsync(5, "hello", "mel"));
        Assert.Equal(0, await svc.CreateEventAsync(new CreateEventRequest { BulkJobId = 31, EventDate = Day }));
        Assert.Equal(0, await svc.CreateEventAsync(new CreateEventRequest { CourierId = 100, EventDate = Day }));
        Assert.Equal(0, await svc.CreateEventAsync(new CreateEventRequest { EventDate = Day }));   // attributed to nothing: refused

        await using var check = CockpitTestHarness.Context(_options);
        var ev = (await check.TblBulkEvents.FindAsync([5], Ct))!;
        Assert.Equal("original", ev.Notes);
        Assert.Null(ev.ClosedDate);
    }

    [Fact]
    public async Task DirectLink_NeedsTheEventToBelongToTheClient_NotJustTheClientToBeTheirs()
    {
        await World();
        await Seed(BulkJob(31, 10, jobId: 1),   // the Sydney client's job
            new TblBulkEvent { BulkEventId = 5, BulkJobId = 31, Notes = "n", Created = Day, EventDate = DateOnly.FromDateTime(Day) });

        var response = await Events().GenerateDirectLinkAsync(5, 20);   // their own client id, another branch's event

        Assert.Equal("Link Declined", response.Url);
    }
}
