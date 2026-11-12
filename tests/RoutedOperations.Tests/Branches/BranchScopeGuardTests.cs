using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Branches;

// Mirrors NpScopeGuardTests for the branch arm. Fixture: branch 1 = SYD
// (default), branch 2 = MEL.
//   client 10 = SYD, client 20 = MEL, client 30 = NULL (default = SYD),
//   client 40 = MEL-tagged but ClientTypeId 4 (the tenant's own client).
//   courier 100 = SYD, courier 200 = MEL, courier 300 = NULL (default = SYD).
public class BranchScopeGuardTests
{
    private const int Syd = 1;
    private const int Mel = 2;

    private sealed class Fixture
    {
        private readonly string _db = Guid.NewGuid().ToString();

        public DynamicDespatchDbContext NewContext() =>
            new(new DbContextOptionsBuilder<DynamicDespatchDbContext>()
                .UseInMemoryDatabase(_db)
                .Options);

        public IDbContextFactory<DynamicDespatchDbContext> Factory()
        {
            var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
            factory.CreateDbContextAsync().Returns(_ => NewContext());
            return factory;
        }

        public async Task SeedAsync(Action<DynamicDespatchDbContext>? extra = null)
        {
            await using var ctx = NewContext();
            ctx.TblBranches.AddRange(
                new TblBranch { BranchId = Syd, IsDefault = true, Active = true },
                new TblBranch { BranchId = Mel, IsDefault = false, Active = true });
            ctx.TucClients.AddRange(
                new TucClient { UcclId = 10, BranchId = Syd, ClientTypeId = 2 },
                new TucClient { UcclId = 20, BranchId = Mel, ClientTypeId = 2 },
                new TucClient { UcclId = 30, BranchId = null, ClientTypeId = 2 },
                new TucClient { UcclId = 40, BranchId = Mel, ClientTypeId = 4 });
            ctx.TucCouriers.AddRange(
                new TucCourier { UccrId = 100, Code = "100", BranchId = Syd },
                new TucCourier { UccrId = 200, Code = "200", BranchId = Mel },
                new TucCourier { UccrId = 300, Code = "300", BranchId = null });
            extra?.Invoke(ctx);
            await ctx.SaveChangesAsync();
        }
    }

    private static IBranchScopeResolver ResolverReturning(BranchScope scope)
    {
        var resolver = Substitute.For<IBranchScopeResolver>();
        resolver.Resolve().Returns(scope);
        return resolver;
    }

    private static BranchScopeGuard Sut(Fixture fx, BranchScope scope, bool optionB = false) =>
        new(ResolverReturning(scope), fx.Factory(),
            Options.Create(new BranchVisibilityOptions { JobVisibleViaCourierBranch = optionB }));

    private static TucJob Job(int id, int? client, int? courier = null, int? route = null, bool isVoid = false) =>
        new() { UcjbId = id, UcjbNumber = $"J-{id}", UcjbClientId = client, UcjbCourierId = courier, RouteId = route, UcjbVoid = isVoid };

    // ---- unrestricted ----

    [Fact]
    public async Task Unrestricted_EveryMethod_NoOp_NoDb()
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new BranchScopeGuard(ResolverReturning(BranchScope.Unrestricted), factory,
            Options.Create(new BranchVisibilityOptions()));

        await sut.EnsureTucJobInScopeAsync(1);
        await sut.EnsureBulkJobInScopeAsync(1);
        await sut.EnsureTucJobByNumberInScopeAsync("J-1");
        await sut.EnsureRouteInScopeAsync(1);
        await sut.EnsureRunInScopeAsync(1);
        var filter = await sut.GetRowFilterAsync();

        Assert.True(filter.IsUnrestricted);
        await factory.DidNotReceive().CreateDbContextAsync();
    }

    // ---- EnsureTucJobInScopeAsync ----

    [Fact]
    public async Task TucJob_ClientInBranch_Passes()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 10)));

        await Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task TucJob_ClientInOtherBranch_Throws403Type()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 20)));

        var ex = await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureTucJobInScopeAsync(1));
        Assert.Contains("tucJob 1", ex.Message);
        // Controllers catch NpLabelScopeException -> 403.
        Assert.IsAssignableFrom<NpLabelScopeException>(ex);
    }

    [Fact]
    public async Task TucJob_ClientWithNullBranch_VisibleToDefaultBranchOnly()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 30)));

        await Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureTucJobInScopeAsync(1);
        await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Mel })).EnsureTucJobInScopeAsync(1));
    }

    [Fact]
    public async Task TucJob_TenantOwnClient_VisibleToEveryBranch()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 40)));

        await Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task TucJob_Missing_Throws()
    {
        var fx = new Fixture();
        await fx.SeedAsync();

        await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureTucJobInScopeAsync(999));
    }

    [Fact]
    public async Task TucJob_MalformedClaim_NoBranches_Throws()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 10)));

        await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(Array.Empty<int>())).EnsureTucJobInScopeAsync(1));
    }

    [Fact]
    public async Task TucJob_OptionA_CourierInBranchDoesNotWiden()
    {
        // MEL client, SYD courier: option A (default) hides it from SYD.
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 20, courier: 100)));

        await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureTucJobInScopeAsync(1));
    }

    [Fact]
    public async Task TucJob_OptionB_CourierInBranchWidens()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 20, courier: 100)));

        await Sut(fx, BranchScope.Restricted(new[] { Syd }), optionB: true).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task TucJob_OptionB_NullCourierBranchCountsAsDefault()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 20, courier: 300)));

        await Sut(fx, BranchScope.Restricted(new[] { Syd }), optionB: true).EnsureTucJobInScopeAsync(1);
    }

    // ---- EnsureBulkJobInScopeAsync ----

    [Fact]
    public async Task BulkJob_ReachesThroughToTucJob()
    {
        // tblBulkJob says SYD client but the live tucJob says MEL: tucJob wins
        // (source of truth, NP parity).
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            c.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobId = 1, ClientId = 10 });
            c.TucJobs.Add(Job(1, client: 20));
        });

        await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureBulkJobInScopeAsync(5));
    }

    [Fact]
    public async Task BulkJob_NoLiveJob_FallsBackToBulkJobClient()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobId = null, ClientId = 10 }));

        await Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureBulkJobInScopeAsync(5);
        await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Mel })).EnsureBulkJobInScopeAsync(5));
    }

    [Fact]
    public async Task BulkJob_Missing_Throws()
    {
        var fx = new Fixture();
        await fx.SeedAsync();

        var ex = await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureBulkJobInScopeAsync(5));
        Assert.Contains("tblBulkJob 5", ex.Message);
    }

    // ---- EnsureTucJobByNumberInScopeAsync ----

    [Fact]
    public async Task ByNumber_AllRowsVisible_Passes()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.AddRange(
            new TucJob { UcjbId = 1, UcjbNumber = "N-1", UcjbClientId = 10 },
            new TucJob { UcjbId = 2, UcjbNumber = "N-1", UcjbClientId = 30 }));

        await Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureTucJobByNumberInScopeAsync("N-1");
    }

    [Fact]
    public async Task ByNumber_AnyRowOutside_Throws()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.AddRange(
            new TucJob { UcjbId = 1, UcjbNumber = "N-1", UcjbClientId = 10 },
            new TucJob { UcjbId = 2, UcjbNumber = "N-1", UcjbClientId = 20 }));

        await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureTucJobByNumberInScopeAsync("N-1"));
    }

    [Fact]
    public async Task ByNumber_NoRows_Passes()
    {
        // NP parity: nothing to leak, the lookup returns nothing anyway.
        var fx = new Fixture();
        await fx.SeedAsync();

        await Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureTucJobByNumberInScopeAsync("nope");
    }

    // ---- EnsureRouteInScopeAsync ----

    [Fact]
    public async Task Route_AllNonVoidJobsVisible_Passes_VoidIgnored()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.AddRange(
            Job(1, client: 10, route: 7),
            Job(2, client: 30, route: 7),
            Job(3, client: 20, route: 7, isVoid: true)));

        await Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureRouteInScopeAsync(7);
    }

    [Fact]
    public async Task Route_MixedBranches_Throws()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.AddRange(
            Job(1, client: 10, route: 7),
            Job(2, client: 20, route: 7)));

        var ex = await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureRouteInScopeAsync(7));
        Assert.Contains("Route 7", ex.Message);
    }

    [Fact]
    public async Task Route_UserWithBothBranches_Passes()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.AddRange(
            Job(1, client: 10, route: 7),
            Job(2, client: 20, route: 7)));

        await Sut(fx, BranchScope.Restricted(new[] { Syd, Mel })).EnsureRouteInScopeAsync(7);
    }

    // ---- EnsureRunInScopeAsync ----

    [Fact]
    public async Task Run_NegativeId_DelegatesToRoute()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 20, route: 7)));

        await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureRunInScopeAsync(-7));
        await Sut(fx, BranchScope.Restricted(new[] { Mel })).EnsureRunInScopeAsync(-7);
    }

    [Fact]
    public async Task Run_PositiveId_ChecksEveryJobOnRun()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            c.TblBulkJobs.AddRange(
                new TblBulkJob { BulkJobId = 5, JobId = 1, ClientId = 10 },
                new TblBulkJob { BulkJobId = 6, JobId = 2, ClientId = 20 });
            c.TucJobs.AddRange(Job(1, client: 10), Job(2, client: 20));
            c.TblBulkJobRuns.AddRange(
                new TblBulkJobRun { Id = 1, RunId = 50, BulkJobId = 5 },
                new TblBulkJobRun { Id = 2, RunId = 50, BulkJobId = 6 },
                new TblBulkJobRun { Id = 3, RunId = 51, BulkJobId = 5 });
        });

        var ex = await Assert.ThrowsAsync<BranchScopeException>(
            () => Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureRunInScopeAsync(50));
        Assert.Contains("Run 50", ex.Message);
        await Sut(fx, BranchScope.Restricted(new[] { Syd })).EnsureRunInScopeAsync(51);
    }

    // ---- GetRowFilterAsync ----

    [Fact]
    public async Task RowFilter_SydUser_SeesSydDefaultAndTenantClients_SydAndNullCouriers()
    {
        var fx = new Fixture();
        await fx.SeedAsync();

        var filter = await Sut(fx, BranchScope.Restricted(new[] { Syd })).GetRowFilterAsync();

        Assert.False(filter.IsUnrestricted);
        Assert.True(filter.IsClientVisible(10));
        Assert.False(filter.IsClientVisible(20));
        Assert.True(filter.IsClientVisible(30));
        Assert.True(filter.IsClientVisible(40));
        Assert.True(filter.IsCourierVisible(100));
        Assert.False(filter.IsCourierVisible(200));
        Assert.True(filter.IsCourierVisible(300));
    }

    [Fact]
    public async Task RowFilter_MelUser_NullBranchRowsBelongToDefaultSoHidden()
    {
        var fx = new Fixture();
        await fx.SeedAsync();

        var filter = await Sut(fx, BranchScope.Restricted(new[] { Mel })).GetRowFilterAsync();

        Assert.False(filter.IsClientVisible(10));
        Assert.True(filter.IsClientVisible(20));
        Assert.False(filter.IsClientVisible(30));
        Assert.True(filter.IsClientVisible(40));
        Assert.False(filter.IsCourierVisible(300));
        Assert.Equal(new[] { 200 }, filter.VisibleCourierIds.OrderBy(i => i));
    }

    [Fact]
    public async Task RowFilter_LoadedOncePerRequest()
    {
        var fx = new Fixture();
        await fx.SeedAsync();
        var factory = fx.Factory();
        var sut = new BranchScopeGuard(ResolverReturning(BranchScope.Restricted(new[] { Syd })), factory,
            Options.Create(new BranchVisibilityOptions()));

        var first = await sut.GetRowFilterAsync();
        var second = await sut.GetRowFilterAsync();

        Assert.Same(first, second);
        await factory.Received(1).CreateDbContextAsync();
    }
}
