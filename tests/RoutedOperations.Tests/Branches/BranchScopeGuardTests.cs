using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Branches;

// Mirrors NpScopeGuardTests for the branch arm, with the 12 Nov rule (master
// spec section 4.1): client, courier or pickup / delivery address on ANY leg
// makes the whole family visible; a run with a visible courier is fully
// visible and actionable.
//
// Fixture: branch 1 = SYD (default, site 43), branch 2 = MEL (site 44).
//   client 10 = SYD, 20 = MEL, 30 = NULL (default = SYD), 40 = MEL but
//   ClientTypeId 4 (the tenant's own client).
//   courier 100 = SYD, 200 = MEL, 300 = NULL (default = SYD).
//   suburb 4301 (Mascot, site 43), 4302 (Parramatta, site 43),
//   suburb 4401 (Tullamarine, site 44), 4402 (Richmond, site 44).
public class BranchScopeGuardTests
{
    private const int Syd = 1;
    private const int Mel = 2;
    private const int SydA = 4301, SydB = 4302, MelAirport = 4401, MelCity = 4402;

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
                new TblBranch { BranchId = Syd, IsDefault = true, Active = true, SiteId = 43 },
                new TblBranch { BranchId = Mel, IsDefault = false, Active = true, SiteId = 44 });
            ctx.TucClients.AddRange(
                new TucClient { UcclId = 10, BranchId = Syd, ClientTypeId = 2 },
                new TucClient { UcclId = 20, BranchId = Mel, ClientTypeId = 2 },
                new TucClient { UcclId = 30, BranchId = null, ClientTypeId = 2 },
                new TucClient { UcclId = 40, BranchId = Mel, ClientTypeId = 4 });
            ctx.TucCouriers.AddRange(
                new TucCourier { UccrId = 100, Code = "100", BranchId = Syd },
                new TucCourier { UccrId = 200, Code = "200", BranchId = Mel },
                new TucCourier { UccrId = 300, Code = "300", BranchId = null });
            ctx.TucSuburbs.AddRange(
                new TucSuburb { UcsuId = SydA, SiteId = 43 },
                new TucSuburb { UcsuId = SydB, SiteId = 43 },
                new TucSuburb { UcsuId = MelAirport, SiteId = 44 },
                new TucSuburb { UcsuId = MelCity, SiteId = 44 });
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

    private static BranchScopeGuard Sut(Fixture fx, params int[] branches) =>
        new(ResolverReturning(BranchScope.Restricted(branches)), fx.Factory());

    private static TucJob Job(int id, int? client, int? courier = null, int? route = null, bool isVoid = false,
        int? parent = null, int? from = SydA, int? to = SydB) =>
        new()
        {
            UcjbId = id, UcjbNumber = $"J-{id}", UcjbClientId = client, UcjbCourierId = courier,
            RouteId = route, UcjbVoid = isVoid, ParentId = parent, UcjbFrom = from, UcjbTo = to,
        };

    // SYD client books Parramatta -> Richmond (MEL). Family: parent 1, pickup
    // leg 2 (SYD -> MEL airport), linehaul leg 3, local delivery leg 4 (MEL
    // airport -> Richmond) on MEL route 9, no courier yet.
    private static void InterbranchFamily(DynamicDespatchDbContext c, int? deliveryCourier = null)
    {
        c.TucJobs.AddRange(
            Job(1, client: 10, from: SydB, to: MelCity),
            Job(2, client: 10, courier: 100, parent: 1, from: SydB, to: SydA),
            Job(3, client: 10, parent: 1, from: SydA, to: MelAirport),
            Job(4, client: 10, courier: deliveryCourier, parent: 1, route: 9, from: MelAirport, to: MelCity));
        c.Routes.Add(new Route { RouteId = 9, Name = "MEL East", Area = "MEL", CreatedBy = "t" });
    }

    // ---- unrestricted ----

    [Fact]
    public async Task Unrestricted_EveryMethod_NoOp_NoDb()
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new BranchScopeGuard(ResolverReturning(BranchScope.Unrestricted), factory);

        await sut.EnsureTucJobInScopeAsync(1);
        await sut.EnsureBulkJobInScopeAsync(1);
        await sut.EnsureTucJobByNumberInScopeAsync("J-1");
        await sut.EnsureRouteInScopeAsync(1);
        await sut.EnsureRunInScopeAsync(1);
        Assert.True((await sut.GetRowFilterAsync()).IsUnrestricted);
        Assert.True(await sut.IsRunFullyVisibleAsync(1));
        Assert.Equal(new[] { 5, 6 }, (await sut.VisibleJobIdsAsync(new[] { 5, 6 })).OrderBy(i => i));
        Assert.Equal(new[] { -2, 7 }, (await sut.VisibleRunIdsAsync(new[] { 7, -2 })).OrderBy(i => i));

        await factory.DidNotReceive().CreateDbContextAsync();
    }

    // ---- single job: client / courier / address arms ----

    [Fact]
    public async Task TucJob_ClientInBranch_Passes()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 10)));

        await Sut(fx, Syd).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task TucJob_UnrelatedOtherBranchJob_Throws403Type()
    {
        // SYD client, SYD courier, SYD -> SYD: nothing for MEL.
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 10, courier: 100)));

        var ex = await Assert.ThrowsAsync<BranchScopeException>(() => Sut(fx, Mel).EnsureTucJobInScopeAsync(1));
        Assert.Contains("tucJob 1", ex.Message);
        Assert.IsAssignableFrom<NpLabelScopeException>(ex);
    }

    [Fact]
    public async Task TucJob_ClientWithNullBranch_BelongsToDefault()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 30)));

        await Sut(fx, Syd).EnsureTucJobInScopeAsync(1);
        await Assert.ThrowsAsync<BranchScopeException>(() => Sut(fx, Mel).EnsureTucJobInScopeAsync(1));
    }

    [Fact]
    public async Task TucJob_TenantOwnClient_VisibleToEveryBranch()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 40)));

        await Sut(fx, Syd).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task TucJob_CourierInBranch_MakesJobVisible()
    {
        // SYD client delivered by a MEL courier.
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 10, courier: 200)));

        await Sut(fx, Mel).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task TucJob_NullBranchCourier_CountsAsDefault()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 20, courier: 300, from: MelAirport, to: MelCity)));

        await Sut(fx, Syd).EnsureTucJobInScopeAsync(1);
    }

    [Theory]
    [InlineData(MelCity, SydA)]   // delivery side not needed: pickup in MEL
    [InlineData(SydA, MelCity)]   // delivery in MEL
    public async Task TucJob_AddressInBranchSite_MakesJobVisible(int from, int to)
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 10, from: from, to: to)));

        await Sut(fx, Mel).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task TucJob_AddressArm_IgnoresInactiveBranch()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            c.TblBranches.Add(new TblBranch { BranchId = 3, IsDefault = false, Active = false, SiteId = 44 });
            c.TucJobs.Add(Job(1, client: 10, to: MelCity));
        });

        await Assert.ThrowsAsync<BranchScopeException>(() => Sut(fx, 3).EnsureTucJobInScopeAsync(1));
    }

    [Fact]
    public async Task TucJob_Missing_Throws()
    {
        var fx = new Fixture();
        await fx.SeedAsync();

        await Assert.ThrowsAsync<BranchScopeException>(() => Sut(fx, Syd).EnsureTucJobInScopeAsync(999));
    }

    [Fact]
    public async Task TucJob_MalformedClaim_NoBranches_Throws()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.Add(Job(1, client: 10)));

        await Assert.ThrowsAsync<BranchScopeException>(() => Sut(fx).EnsureTucJobInScopeAsync(1));
    }

    // ---- job family (Steve's Melbourne example) ----

    [Fact]
    public async Task Family_MelUser_SeesWholeInterbranchFamily_IncludingSydPickupLeg()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => InterbranchFamily(c));
        var sut = Sut(fx, Mel);

        // Parent, SYD pickup leg (SYD -> SYD, SYD courier), linehaul, MEL leg.
        foreach (var id in new[] { 1, 2, 3, 4 })
            await sut.EnsureTucJobInScopeAsync(id);
    }

    [Fact]
    public async Task Family_ViaCourierOnAnotherLeg()
    {
        // No MEL address anywhere; the MEL courier on leg 4 opens the family.
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.AddRange(
            Job(1, client: 10),
            Job(2, client: 10, courier: 100, parent: 1),
            Job(4, client: 10, courier: 200, parent: 1)));

        // SYD pickup leg and the parent are both visible to MEL.
        await Sut(fx, Mel).EnsureTucJobInScopeAsync(2);
        await Sut(fx, Mel).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task Family_ViaRootParentId()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.AddRange(
            Job(1, client: 10),
            Job(2, client: 10, parent: 1),
            new TucJob { UcjbId = 5, UcjbNumber = "J-5", UcjbClientId = 10, ParentId = 2, RootParentId = 1, UcjbFrom = SydA, UcjbTo = MelCity }));

        await Sut(fx, Mel).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task Family_ViaRunCourier_BeforeLegIsDespatched()
    {
        // Leg has no courier yet but sits on a run pre-assigned to a MEL courier.
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            c.TucJobs.Add(Job(1, client: 10));
            c.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobId = 1, ClientId = 10 });
            c.TblBulkRuns.Add(new TblBulkRun { Id = 50, CourierId = 200 });
            c.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, RunId = 50, BulkJobId = 5 });
        });

        await Sut(fx, Mel).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task Family_UnrelatedSydJobStaysHidden()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            InterbranchFamily(c);
            c.TucJobs.Add(Job(20, client: 10, courier: 100, from: SydA, to: SydB));
        });

        var visible = await Sut(fx, Mel).VisibleJobIdsAsync(new[] { 1, 2, 3, 4, 20 });

        Assert.Equal(new[] { 1, 2, 3, 4 }, visible.OrderBy(i => i));
    }

    // ---- bulk job ----

    [Fact]
    public async Task BulkJob_ReachesThroughToTucJobFamily()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            InterbranchFamily(c);
            c.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobId = 2, ClientId = 10 });
        });

        await Sut(fx, Mel).EnsureBulkJobInScopeAsync(5);
    }

    [Fact]
    public async Task BulkJob_NoLiveJob_FallsBackToBulkClientCourierOrRunCourier()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            c.TblBulkJobs.AddRange(
                new TblBulkJob { BulkJobId = 5, JobId = null, ClientId = 10 },
                new TblBulkJob { BulkJobId = 6, JobId = null, ClientId = 10 });
            c.TblBulkRuns.Add(new TblBulkRun { Id = 50, CourierId = 200 });
            c.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, RunId = 50, BulkJobId = 6 });
        });

        await Sut(fx, Syd).EnsureBulkJobInScopeAsync(5);
        await Assert.ThrowsAsync<BranchScopeException>(() => Sut(fx, Mel).EnsureBulkJobInScopeAsync(5));
        await Sut(fx, Mel).EnsureBulkJobInScopeAsync(6);
    }

    [Fact]
    public async Task BulkJob_Missing_Throws()
    {
        var fx = new Fixture();
        await fx.SeedAsync();

        var ex = await Assert.ThrowsAsync<BranchScopeException>(() => Sut(fx, Syd).EnsureBulkJobInScopeAsync(5));
        Assert.Contains("tblBulkJob 5", ex.Message);
    }

    // ---- by number ----

    [Fact]
    public async Task ByNumber_AllRowsVisible_Passes_AnyOutside_Throws()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => c.TucJobs.AddRange(
            new TucJob { UcjbId = 1, UcjbNumber = "N-1", UcjbClientId = 10, UcjbFrom = SydA, UcjbTo = SydB },
            new TucJob { UcjbId = 2, UcjbNumber = "N-1", UcjbClientId = 30, UcjbFrom = SydA, UcjbTo = SydB },
            new TucJob { UcjbId = 3, UcjbNumber = "N-2", UcjbClientId = 10, UcjbFrom = SydA, UcjbTo = SydB },
            new TucJob { UcjbId = 4, UcjbNumber = "N-2", UcjbClientId = 20, UcjbFrom = MelCity, UcjbTo = MelCity }));

        await Sut(fx, Syd).EnsureTucJobByNumberInScopeAsync("N-1");
        await Assert.ThrowsAsync<BranchScopeException>(() => Sut(fx, Syd).EnsureTucJobByNumberInScopeAsync("N-2"));
        await Sut(fx, Syd).EnsureTucJobByNumberInScopeAsync("none");
    }

    // ---- routes / runs ----

    [Fact]
    public async Task Route_MelRouteBeforeCourierAssigned_ActionableForMel_ViaDeliveryAddress()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c => InterbranchFamily(c));

        await Sut(fx, Mel).EnsureRouteInScopeAsync(9);
        await Sut(fx, Mel).EnsureRunInScopeAsync(-9);
    }

    [Fact]
    public async Task Route_MixedRoute_NoVisibleCourier_Throws()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            c.TucJobs.AddRange(
                Job(1, client: 10, route: 7, to: MelCity),
                Job(2, client: 10, route: 7, from: SydA, to: SydB));
            c.Routes.Add(new Route { RouteId = 7, Name = "R7", Area = "x", CreatedBy = "t" });
        });

        var ex = await Assert.ThrowsAsync<BranchScopeException>(() => Sut(fx, Mel).EnsureRouteInScopeAsync(7));
        Assert.Contains("Route 7", ex.Message);
    }

    [Fact]
    public async Task Route_DefaultCourierInBranch_WholeRouteActionable()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            c.TucJobs.AddRange(
                Job(1, client: 10, route: 7, from: SydA, to: SydB),
                Job(2, client: 10, route: 7, from: SydA, to: SydB, isVoid: true));
            c.Routes.Add(new Route { RouteId = 7, Name = "R7", Area = "x", CreatedBy = "t", DefaultCourierId = 200 });
        });

        await Sut(fx, Mel).EnsureRouteInScopeAsync(7);
    }

    [Fact]
    public async Task Run_MelCourier_WholeRunActionable_EvenWithSydOriginJobs()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            c.TucJobs.AddRange(Job(1, client: 10, from: SydA, to: SydB), Job(2, client: 20, from: MelCity, to: MelCity));
            c.TblBulkJobs.AddRange(
                new TblBulkJob { BulkJobId = 5, JobId = 1, ClientId = 10 },
                new TblBulkJob { BulkJobId = 6, JobId = 2, ClientId = 20 });
            c.TblBulkRuns.AddRange(new TblBulkRun { Id = 50, CourierId = 200 }, new TblBulkRun { Id = 51, CourierId = null });
            c.TblBulkJobRuns.AddRange(
                new TblBulkJobRun { Id = 1, RunId = 50, BulkJobId = 5 },
                new TblBulkJobRun { Id = 2, RunId = 50, BulkJobId = 6 },
                new TblBulkJobRun { Id = 3, RunId = 51, BulkJobId = 5 },
                new TblBulkJobRun { Id = 4, RunId = 51, BulkJobId = 6 });
        });
        var sut = Sut(fx, Mel);

        await sut.EnsureRunInScopeAsync(50);
        Assert.True(await sut.IsRunFullyVisibleAsync(50));
        // Run 51 has no courier, but SYD job 1 also sits on MEL-courier run
        // 50, which makes its family visible, so every job on 51 is visible.
        await sut.EnsureRunInScopeAsync(51);
    }

    [Fact]
    public async Task Run_NoCourier_SydJobNotOnAnyMelRun_Throws_ButListedViaMelJob()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            c.TucJobs.AddRange(Job(1, client: 10, from: SydA, to: SydB), Job(2, client: 20, from: MelCity, to: MelCity));
            c.TblBulkJobs.AddRange(
                new TblBulkJob { BulkJobId = 5, JobId = 1, ClientId = 10 },
                new TblBulkJob { BulkJobId = 6, JobId = 2, ClientId = 20 });
            c.TblBulkRuns.AddRange(new TblBulkRun { Id = 51 }, new TblBulkRun { Id = 52 });
            c.TblBulkJobRuns.AddRange(
                new TblBulkJobRun { Id = 1, RunId = 51, BulkJobId = 5 },
                new TblBulkJobRun { Id = 2, RunId = 51, BulkJobId = 6 },
                new TblBulkJobRun { Id = 3, RunId = 52, BulkJobId = 5 });
        });
        var sut = Sut(fx, Mel);

        var ex = await Assert.ThrowsAsync<BranchScopeException>(() => sut.EnsureRunInScopeAsync(51));
        Assert.Contains("Run 51", ex.Message);
        Assert.False(await sut.IsRunFullyVisibleAsync(51));
        Assert.Equal(new[] { 51 }, (await sut.VisibleRunIdsAsync(new[] { 51, 52 })).OrderBy(i => i));
    }

    [Fact]
    public async Task VisibleRunIds_RouteRuns_ByAddressOrCourier()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            InterbranchFamily(c); // route 9 carries MEL leg 4
            c.TucJobs.Add(Job(30, client: 10, route: 8, from: SydA, to: SydB));
            c.Routes.Add(new Route { RouteId = 8, Name = "SYD", Area = "SYD", CreatedBy = "t" });
        });

        var visible = await Sut(fx, Mel).VisibleRunIdsAsync(new[] { -9, -8 });

        Assert.Equal(new[] { -9 }, visible);
    }

    // ---- row filter ----

    [Fact]
    public async Task RowFilter_SydUser_Sets()
    {
        var fx = new Fixture();
        await fx.SeedAsync();

        var filter = await Sut(fx, Syd).GetRowFilterAsync();

        Assert.True(filter.IsClientVisible(10));
        Assert.False(filter.IsClientVisible(20));
        Assert.True(filter.IsClientVisible(30));
        Assert.True(filter.IsClientVisible(40));
        Assert.True(filter.IsCourierVisible(300));
        Assert.False(filter.IsCourierVisible(200));
        Assert.True(filter.IsSiteVisible(43));
        Assert.False(filter.IsSiteVisible(44));
    }

    [Fact]
    public async Task RowFilter_LoadedOncePerRequest()
    {
        var fx = new Fixture();
        await fx.SeedAsync();
        var factory = fx.Factory();
        var sut = new BranchScopeGuard(ResolverReturning(BranchScope.Restricted(new[] { Syd })), factory);

        var first = await sut.GetRowFilterAsync();
        var second = await sut.GetRowFilterAsync();

        Assert.Same(first, second);
        await factory.Received(1).CreateDbContextAsync();
    }

    // ---- list helpers ----

    private sealed record Row(int? JobId, int? ClientId, int? CourierId);

    [Fact]
    public async Task FilterJobRows_ExpandsFamily_AndFallsBackWithoutJobId()
    {
        var fx = new Fixture();
        await fx.SeedAsync(c =>
        {
            InterbranchFamily(c);
            c.TucJobs.Add(Job(20, client: 10, courier: 100));
        });
        var rows = new List<Row>
        {
            new(2, 10, 100),      // SYD pickup leg of the MEL-bound family -> kept
            new(20, 10, 100),     // unrelated SYD job -> dropped
            new(null, 20, null),  // no job id, MEL client -> kept
            new(null, 10, 100),   // no job id, SYD client + courier -> dropped
        };

        var kept = await Sut(fx, Mel).FilterJobRowsAsync(rows, r => r.JobId, r => r.ClientId, r => r.CourierId);

        Assert.Equal(new[] { rows[0], rows[2] }, kept);
    }
}
