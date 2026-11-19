using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Branches;

// The branch guard (B2b): a job family is visible when any leg's client, courier or pickup/delivery suburb site is the
// caller's; a run is actionable when its courier or every job is the caller's and listed when any job is.
public class BranchScopeGuardTests
{
    private const int Sydney = 1;
    private const int Melbourne = 2;
    private const int SydneySite = 43;
    private const int MelbourneSite = 44;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private readonly DbContextOptions<DynamicDespatchDbContext> _options =
        new DbContextOptionsBuilder<DynamicDespatchDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;

    // A fresh context over the shared store per call, as the real factory gives.
    private IDbContextFactory<DynamicDespatchDbContext> Factory()
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContextAsync().Returns(_ => new DynamicDespatchDbContext(_options));
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(_options));   // the synchronous scope properties
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>()).Returns(_ => new DynamicDespatchDbContext(_options));
        return factory;
    }

    private BranchScopeGuard Guard(BranchScope scope)
    {
        var resolver = Substitute.For<IBranchScopeResolver>();
        resolver.Resolve().Returns(scope);
        return new BranchScopeGuard(resolver, Factory());
    }

    private BranchScopeGuard SydneyGuard(bool defaultIsSydney = true) => Guard(BranchScope.Restricted([Sydney]));
    private BranchScopeGuard MelbourneGuard() => Guard(BranchScope.Restricted([Melbourne]));

    private async Task Seed(params object[] rows)
    {
        await using var context = new DynamicDespatchDbContext(_options);
        context.AddRange(rows);
        await context.SaveChangesAsync(Ct);
    }

    private static TucClient Client(int id, int? branch, int type = 2) => new() { UcclId = id, BranchId = branch, ClientTypeId = type };
    private static TucCourier Courier(int id, int? branch) => new() { UccrId = id, BranchId = branch };
    private static TucSuburb Suburb(int id, int? site) => new() { UcsuId = id, SiteId = site };

    private static Route Route(int id, int? defaultCourier) =>
        new() { RouteId = id, DefaultCourierId = defaultCourier, Name = $"Route {id}", Area = "A", CreatedBy = "T" };

    private static TucJob Job(int id, int? client = null, int? courier = null, int? from = null, int? to = null,
        int? parent = null, int? root = null, int? route = null, bool isVoid = false, string? number = null) => new()
    {
        UcjbId = id, UcjbNumber = number ?? $"J{id}", UcjbClientId = client, UcjbCourierId = courier, UcjbFrom = from, UcjbTo = to,
        ParentId = parent, RootParentId = root, RouteId = route, UcjbVoid = isVoid
    };

    // Sydney is the default branch; clients 10 (Sydney), 20 (Melbourne), 30 (no branch), 40 (house); couriers likewise.
    private Task World() => Seed(
        new TblBranch { BranchId = Sydney, IsDefault = true, Active = true, SiteId = SydneySite },
        new TblBranch { BranchId = Melbourne, IsDefault = false, Active = true, SiteId = MelbourneSite },
        Client(10, Sydney), Client(20, Melbourne), Client(30, null), Client(40, null, type: 4),
        Courier(100, Sydney), Courier(200, Melbourne), Courier(300, null),
        Suburb(1, SydneySite), Suburb(2, MelbourneSite), Suburb(3, null));

    private async Task<bool> Visible(BranchScopeGuard guard, int jobId) => (await guard.VisibleJobIdsAsync([jobId])).Contains(jobId);

    // ---- unrestricted callers ----

    [Fact]
    public async Task Unrestricted_NeverTouchesTheDatabase_AndNothingIsDenied()
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var resolver = Substitute.For<IBranchScopeResolver>();
        resolver.Resolve().Returns(BranchScope.Unrestricted);
        var guard = new BranchScopeGuard(resolver, factory);

        await guard.EnsureTucJobInScopeAsync(9);
        await guard.EnsureBulkJobInScopeAsync(9);
        await guard.EnsureTucJobByNumberInScopeAsync("X");
        await guard.EnsureRouteInScopeAsync(9);
        await guard.EnsureRunInScopeAsync(9);
        Assert.Equal([1, 2], (await guard.VisibleJobIdsAsync([1, 2])).Order());
        Assert.True(await guard.IsRunFullyVisibleAsync(9));
        Assert.False(guard.IsRestricted);

        await factory.DidNotReceiveWithAnyArgs().CreateDbContextAsync();
    }

    // ---- a job by its own legs ----

    [Fact]
    public async Task AJob_IsVisible_ByClientBranch()
    {
        await World();
        await Seed(Job(1, client: 10), Job(2, client: 20));

        Assert.True(await Visible(SydneyGuard(), 1));
        Assert.False(await Visible(SydneyGuard(), 2));
        Assert.True(await Visible(MelbourneGuard(), 2));
    }

    [Fact]
    public async Task AJob_IsVisible_ByCourierHomeBranch()
    {
        await World();
        await Seed(Job(1, client: 10, courier: 200));

        Assert.True(await Visible(MelbourneGuard(), 1));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task AJob_IsVisible_ByPickupOrDeliverySuburbSite(bool delivery)
    {
        await World();
        await Seed(delivery ? Job(1, client: 10, from: 1, to: 2) : Job(1, client: 10, from: 2, to: 1));

        Assert.True(await Visible(MelbourneGuard(), 1));
    }

    [Fact]
    public async Task ASuburbWithNoSite_NeverMakesAJobVisible()
    {
        await World();
        await Seed(Job(1, client: 10, from: 3, to: 3));

        Assert.False(await Visible(MelbourneGuard(), 1));
    }

    [Fact]
    public async Task AnInactiveBranchesSite_NoLongerMatchesAddresses()
    {
        await Seed(
            new TblBranch { BranchId = Sydney, IsDefault = true, Active = true, SiteId = SydneySite },
            new TblBranch { BranchId = Melbourne, IsDefault = false, Active = false, SiteId = MelbourneSite },
            Client(10, Sydney), Suburb(2, MelbourneSite), Job(1, client: 10, to: 2));

        Assert.False(await Visible(MelbourneGuard(), 1));
    }

    // ---- NULL branch = the default branch; house accounts ----

    [Fact]
    public async Task ANullBranchClientOrCourier_BelongsToTheDefaultBranch()
    {
        await World();
        await Seed(Job(1, client: 30), Job(2, client: 20, courier: 300));

        Assert.True(await Visible(SydneyGuard(), 1));      // client with no branch, Sydney is the default
        Assert.False(await Visible(MelbourneGuard(), 1));
        Assert.True(await Visible(SydneyGuard(), 2));      // courier with no home branch
        Assert.True(await Visible(MelbourneGuard(), 2));   // and the Melbourne client, for Melbourne
    }

    [Fact]
    public async Task AHouseAccountsJob_IsVisibleToEveryLimitedUser()
    {
        await World();
        await Seed(Job(1, client: 40));

        Assert.True(await Visible(MelbourneGuard(), 1));
    }

    [Fact]
    public async Task AnEmptyBranchList_SeesNothingExceptHouseAccounts()
    {
        await World();
        await Seed(Job(1, client: 10), Job(2, client: 20), Job(3, client: 40));
        var guard = Guard(BranchScope.Restricted([]));

        Assert.Equal([3], (await guard.VisibleJobIdsAsync([1, 2, 3])).Order());
    }

    // ---- families ----

    [Fact]
    public async Task OneVisibleLeg_MakesTheWholeFamilyVisible()
    {
        await World();
        await Seed(
            Job(1, client: 10),
            Job(2, client: 10, courier: 100, from: 1, to: 1, parent: 1, root: 1),
            Job(3, client: 10, courier: 200, from: 2, to: 2, parent: 1, root: 1),
            Job(9, client: 10));

        var melbourne = await MelbourneGuard().VisibleJobIdsAsync([1, 2, 3, 9]);

        Assert.Equal([1, 2, 3], melbourne.Order());   // not the unrelated Sydney job
    }

    [Fact]
    public async Task ChildrenLinkedOnlyByParentId_AreStillOneFamily()
    {
        await World();
        await Seed(Job(1, client: 10), Job(2, client: 20, parent: 1));

        Assert.Equal([1, 2], (await MelbourneGuard().VisibleJobIdsAsync([1, 2])).Order());
    }

    [Fact]
    public async Task AnotherFamily_StaysHidden()
    {
        await World();
        await Seed(Job(1, client: 20), Job(2, client: 20, parent: 1, root: 1), Job(7, client: 10), Job(8, client: 10, parent: 7, root: 7));

        Assert.Equal([1, 2], (await MelbourneGuard().VisibleJobIdsAsync([1, 2, 7, 8])).Order());
    }

    // ---- ensure ----

    [Fact]
    public async Task EnsureTucJob_PassesForAVisibleFamily_AndThrowsForAHiddenOrMissingOne()
    {
        await World();
        await Seed(Job(1, client: 20), Job(2, client: 10));

        await MelbourneGuard().EnsureTucJobInScopeAsync(1);
        var hidden = await Assert.ThrowsAsync<BranchScopeException>(() => MelbourneGuard().EnsureTucJobInScopeAsync(2));
        await Assert.ThrowsAsync<BranchScopeException>(() => MelbourneGuard().EnsureTucJobInScopeAsync(999));

        Assert.Contains("tucJob 2", hidden.Message);
    }

    [Fact]
    public async Task ABranchDenial_IsAnNpLabelScopeException_SoControllersReturn403()
    {
        await World();
        await Seed(Job(1, client: 10));

        await Assert.ThrowsAnyAsync<NpLabelScopeException>(() => MelbourneGuard().EnsureTucJobInScopeAsync(1));
    }

    [Fact]
    public async Task EnsureBulkJob_FollowsItsTucJobsFamily_OrItsOwnClientAndCourier()
    {
        await World();
        await Seed(
            Job(1, client: 20),
            new TblBulkJob { BulkJobId = 5, JobId = 1, ClientId = 20 },
            new TblBulkJob { BulkJobId = 6, JobId = null, ClientId = 20 },                    // never became a tucJob
            new TblBulkJob { BulkJobId = 7, JobId = null, ClientId = 10, CourierId = 200 },   // courier is Melbourne's
            new TblBulkJob { BulkJobId = 8, JobId = null, ClientId = 10 });

        await MelbourneGuard().EnsureBulkJobInScopeAsync(5);
        await MelbourneGuard().EnsureBulkJobInScopeAsync(6);
        await MelbourneGuard().EnsureBulkJobInScopeAsync(7);
        await Assert.ThrowsAsync<BranchScopeException>(() => MelbourneGuard().EnsureBulkJobInScopeAsync(8));
        await Assert.ThrowsAsync<BranchScopeException>(() => MelbourneGuard().EnsureBulkJobInScopeAsync(404));
    }

    [Fact]
    public async Task EnsureJobByNumber_NeedsEveryRowWithThatNumberVisible_AndAtLeastOne()
    {
        await World();
        await Seed(Job(1, client: 20, number: "A"), Job(2, client: 20, number: "B"), Job(3, client: 10, number: "B"));

        await MelbourneGuard().EnsureTucJobByNumberInScopeAsync("A");
        await Assert.ThrowsAsync<BranchScopeException>(() => MelbourneGuard().EnsureTucJobByNumberInScopeAsync("B"));
        await Assert.ThrowsAsync<BranchScopeException>(() => MelbourneGuard().EnsureTucJobByNumberInScopeAsync("nope"));
    }

    // ---- routes ----

    [Fact]
    public async Task Route_IsVisible_WhenItsDefaultCourierIs_OrEveryNonVoidJobIs()
    {
        await World();
        await Seed(
            Route(1, 200),
            Route(2, null),
            Route(3, null),
            Job(1, client: 10, route: 1),
            Job(2, client: 20, route: 2), Job(3, client: 20, route: 2),
            Job(4, client: 20, route: 3), Job(5, client: 10, route: 3), Job(6, client: 10, route: 3, isVoid: true));
        var m = MelbourneGuard();

        await m.EnsureRouteInScopeAsync(1);   // Melbourne's default courier
        await m.EnsureRouteInScopeAsync(2);   // every job is Melbourne's
        await Assert.ThrowsAsync<BranchScopeException>(() => m.EnsureRouteInScopeAsync(3));   // mixed
    }

    // ---- runs ----

    private async Task SeedRun(int runId, int? courier, params int[] bulkJobIds)
    {
        await Seed(new TblBulkRun { Id = runId, CourierId = courier });
        await Seed(bulkJobIds.Select(b => (object)new TblBulkJobRun { RunId = runId, BulkJobId = b }).ToArray());
    }

    private async Task WorldWithBulkJobs()
    {
        await World();
        await Seed(
            Job(1, client: 20), Job(2, client: 10),
            new TblBulkJob { BulkJobId = 11, JobId = 1, ClientId = 20 },   // Melbourne's job
            new TblBulkJob { BulkJobId = 12, JobId = 2, ClientId = 10 });  // Sydney's job
    }

    [Fact]
    public async Task Run_IsFullyVisible_WhenItsCourierIs_EvenIfSomeJobsAreNot()
    {
        await WorldWithBulkJobs();
        await SeedRun(1, courier: 200, 11, 12);

        Assert.True(await MelbourneGuard().IsRunFullyVisibleAsync(1));
        await MelbourneGuard().EnsureRunInScopeAsync(1);
    }

    [Fact]
    public async Task Run_IsFullyVisible_WhenEveryJobIs()
    {
        await WorldWithBulkJobs();
        await SeedRun(1, courier: null, 11);

        Assert.True(await MelbourneGuard().IsRunFullyVisibleAsync(1));
    }

    [Fact]
    public async Task Run_WithSomeVisibleJobs_IsListedButNotActionable()
    {
        await WorldWithBulkJobs();
        await SeedRun(1, courier: null, 11, 12);
        var m = MelbourneGuard();

        Assert.Contains(1, await m.VisibleRunIdsAsync([1]));       // listed (shows only its visible jobs)
        Assert.False(await m.IsRunFullyVisibleAsync(1));            // not actionable
        await Assert.ThrowsAsync<BranchScopeException>(() => m.EnsureRunInScopeAsync(1));
    }

    [Fact]
    public async Task Run_WithNothingOfTheirs_IsNeitherListedNorActionable()
    {
        await WorldWithBulkJobs();
        await SeedRun(1, courier: 100, 12);
        var m = MelbourneGuard();

        Assert.Empty(await m.VisibleRunIdsAsync([1]));
        Assert.False(await m.IsRunFullyVisibleAsync(1));
    }

    [Fact]
    public async Task AnEmptyRun_IsOnlyVisible_ByItsCourier()
    {
        await World();
        await SeedRun(1, courier: 200);
        await SeedRun(2, courier: 100);
        var m = MelbourneGuard();

        Assert.True(await m.IsRunFullyVisibleAsync(1));
        Assert.False(await m.IsRunFullyVisibleAsync(2));
    }

    [Fact]
    public async Task ASyntheticRouteRun_UsesTheRoutesCourierAndJobs()
    {
        await World();
        await Seed(
            Route(5, 200),
            Route(6, null),
            Job(1, client: 10, route: 5),
            Job(2, client: 10, route: 6));
        var m = MelbourneGuard();

        Assert.True(await m.IsRunFullyVisibleAsync(-5));    // route 5's default courier is Melbourne's
        Assert.False(await m.IsRunFullyVisibleAsync(-6));
        Assert.Equal([-5], (await m.VisibleRunIdsAsync([-5, -6])).Order());
    }

    [Fact]
    public async Task VisibleRunIds_FiltersAList()
    {
        await WorldWithBulkJobs();
        await SeedRun(1, courier: 200, 12);       // visible by courier
        await SeedRun(2, courier: null, 11);      // visible by job
        await SeedRun(3, courier: 100, 12);       // not visible

        Assert.Equal([1, 2], (await MelbourneGuard().VisibleRunIdsAsync([1, 2, 3])).Order());
    }

    // ---- client and courier id sets ----

    [Fact]
    public async Task ClientAndCourierSets_FollowTheBranchRules()
    {
        await World();
        var s = SydneyGuard();

        Assert.Equal([10, 30, 40], (await s.VisibleClientIdsAsync([10, 20, 30, 40])).Order());   // Sydney, no branch (default), house
        Assert.Equal([100, 300], (await s.VisibleCourierIdsAsync([100, 200, 300])).Order());
        Assert.Equal([20, 40], (await MelbourneGuard().VisibleClientIdsAsync([10, 20, 30, 40])).Order());
        Assert.Equal([200], (await MelbourneGuard().VisibleCourierIdsAsync([100, 200, 300])).Order());
    }

    // ---- bulk jobs (Route Builder works in tblBulkJob ids) ----

    [Fact]
    public async Task VisibleBulkJobIds_FollowTheTucJobFamily_OrTheirOwnClientAndCourier()
    {
        await World();
        await Seed(
            Job(1, client: 20), Job(2, client: 10),
            new TblBulkJob { BulkJobId = 11, JobId = 1, ClientId = 20 },                      // Melbourne's tucJob
            new TblBulkJob { BulkJobId = 12, JobId = 2, ClientId = 10 },                      // Sydney's tucJob
            new TblBulkJob { BulkJobId = 13, JobId = null, ClientId = 20 },                   // no tucJob, Melbourne's client
            new TblBulkJob { BulkJobId = 14, JobId = null, ClientId = 10, CourierId = 200 },  // no tucJob, Melbourne's courier
            new TblBulkJob { BulkJobId = 15, JobId = null, ClientId = 10 });                  // nothing of theirs

        var visible = await MelbourneGuard().VisibleBulkJobIdsAsync([11, 12, 13, 14, 15, 99]);

        Assert.Equal([11, 13, 14], visible.Order());
    }

    [Fact]
    public async Task TheSynchronousScopeProperties_ReportTheCallersBranchesAndDefaultBranch()
    {
        await World();

        Assert.Equal([Melbourne], MelbourneGuard().BranchIds);
        Assert.False(MelbourneGuard().DefaultBranchInScope);   // Sydney is the default, and the caller is Melbourne's only
        Assert.True(SydneyGuard().DefaultBranchInScope);
        Assert.False(Guard(BranchScope.Unrestricted).DefaultBranchInScope);
    }

    [Fact]
    public async Task WhereCourierVisible_NarrowsACourierQueryInSql()
    {
        await World();
        await using var context = new DynamicDespatchDbContext(_options);

        var melbourne = await (await MelbourneGuard().WhereCourierVisibleAsync(context.TucCouriers)).Select(c => c.UccrId).OrderBy(i => i).ToListAsync(Ct);
        var sydney = await (await SydneyGuard().WhereCourierVisibleAsync(context.TucCouriers)).Select(c => c.UccrId).OrderBy(i => i).ToListAsync(Ct);

        Assert.Equal([200], melbourne);
        Assert.Equal([100, 300], sydney);   // 300 has no branch: the default branch, which Sydney holds
    }

    // ---- list helpers ----

    private sealed record Row(int? JobId, int? ClientId, int? CourierId);

    [Fact]
    public async Task FilterJobRows_JudgesByFamily_AndFallsBackToClientOrCourierWhenThereIsNoJob()
    {
        await World();
        await Seed(Job(1, client: 10), Job(2, client: 10, parent: 1, root: 1, courier: 200), Job(3, client: 10));
        var rows = new List<Row>
        {
            new(1, 10, null),      // in a family Melbourne sees through leg 2
            new(3, 10, null),      // not
            new(null, 20, null),   // no tucJob, Melbourne's client
            new(null, 10, 200),    // no tucJob, Melbourne's courier
            new(null, 10, null),   // no tucJob, nothing of theirs
        };

        var kept = await MelbourneGuard().FilterJobRowsAsync(rows, r => r.JobId, r => r.ClientId, r => r.CourierId);

        Assert.Equal([rows[0], rows[2], rows[3]], kept);
    }

    [Fact]
    public async Task ListHelpers_ReturnTheListUntouched_ForUnrestrictedCallers()
    {
        var resolver = Substitute.For<IBranchScopeResolver>();
        resolver.Resolve().Returns(BranchScope.Unrestricted);
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var guard = new BranchScopeGuard(resolver, factory);
        var rows = new List<Row> { new(1, 10, 100) };

        Assert.Same(rows, await guard.FilterJobRowsAsync(rows, r => r.JobId, r => r.ClientId, r => r.CourierId));
        Assert.Same(rows, await guard.FilterCourierRowsAsync(rows, r => r.CourierId));
        Assert.Same(rows, await guard.FilterClientRowsAsync(rows, r => r.ClientId));
        Assert.Same(rows, await guard.FilterRunRowsAsync(rows, _ => 1));
        await factory.DidNotReceiveWithAnyArgs().CreateDbContextAsync();
    }

    [Fact]
    public async Task FilterCourierRows_AndClientRows_KeepOnlyTheCallersOwn()
    {
        await World();
        var rows = new List<Row> { new(null, 10, 100), new(null, 20, 200), new(null, 30, 300) };

        var couriers = await MelbourneGuard().FilterCourierRowsAsync(rows, r => r.CourierId);
        var clients = await MelbourneGuard().FilterClientRowsAsync(rows, r => r.ClientId);

        Assert.Equal([rows[1]], couriers);
        Assert.Equal([rows[1]], clients);
    }

    // ---- the combined guard registered as INpScopeGuard ----

    [Fact]
    public async Task NpAndBranchGuard_RunsBothChecks_AndEitherCanDeny()
    {
        var np = Substitute.For<INpScopeResolver>();
        np.ResolveAsync().Returns(new NpScope(IsAdmin: true, NpAgentId: null));
        await World();
        await Seed(Job(1, client: 10));
        var npGuard = new NpScopeGuard(np, Factory());
        var both = new NpAndBranchScopeGuard(npGuard, MelbourneGuard());

        // NP check passes (admin), the branch check denies.
        await Assert.ThrowsAsync<BranchScopeException>(() => both.EnsureTucJobInScopeAsync(1));

        // A Sydney user passes both.
        await new NpAndBranchScopeGuard(npGuard, SydneyGuard()).EnsureTucJobInScopeAsync(1);

        // An NP denial wins before the branch guard is asked.
        var denyingNp = Substitute.For<INpScopeResolver>();
        denyingNp.ResolveAsync().Returns(new NpScope(IsAdmin: false, NpAgentId: 99));
        var branch = Substitute.For<IBranchScopeGuard>();
        var npDenied = new NpAndBranchScopeGuard(new NpScopeGuard(denyingNp, Factory()), branch);
        await Assert.ThrowsAsync<NpLabelScopeException>(() => npDenied.EnsureTucJobInScopeAsync(1));
        await branch.DidNotReceiveWithAnyArgs().EnsureTucJobInScopeAsync(0);
    }

    [Fact]
    public async Task NpAndBranchGuard_ForwardsEveryMethodToBothGuards()
    {
        var np = Substitute.For<INpScopeResolver>();
        np.ResolveAsync().Returns(new NpScope(IsAdmin: true, NpAgentId: null));
        var branch = Substitute.For<IBranchScopeGuard>();
        var both = new NpAndBranchScopeGuard(new NpScopeGuard(np, Factory()), branch);

        await both.EnsureTucJobInScopeAsync(1);
        await both.EnsureBulkJobInScopeAsync(2);
        await both.EnsureTucJobByNumberInScopeAsync("N");
        await both.EnsureRouteInScopeAsync(3);
        await both.EnsureRunInScopeAsync(4);

        await branch.Received(1).EnsureTucJobInScopeAsync(1);
        await branch.Received(1).EnsureBulkJobInScopeAsync(2);
        await branch.Received(1).EnsureTucJobByNumberInScopeAsync("N");
        await branch.Received(1).EnsureRouteInScopeAsync(3);
        await branch.Received(1).EnsureRunInScopeAsync(4);
    }
}
