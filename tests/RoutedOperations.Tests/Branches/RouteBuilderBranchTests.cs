using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services.Courier;
using RoutedOperations.Core.Application.Services.Job;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.Schedule;
using RoutedOperations.Core.Application.Services.RecurringRoute;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Tests.Services;

namespace RoutedOperations.Tests.Branches;

// Route Builder and the other policy-only lists (B2c) for a branch-limited caller. The Melbourne user sees Melbourne's
// clients, couriers, jobs and runs (plus the house accounts); Sydney's stay hidden; an unrestricted caller sees everything.
public class RouteBuilderBranchTests
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

    private IBranchScopeGuard MelbourneGuard()
    {
        var resolver = Substitute.For<IBranchScopeResolver>();
        resolver.Resolve().Returns(BranchScope.Restricted([Melbourne]));
        return new BranchScopeGuard(resolver, Factory());
    }

    private Task World() => Seed(
        new TblBranch { BranchId = Sydney, IsDefault = true, Active = true, SiteId = 43 },
        new TblBranch { BranchId = Melbourne, IsDefault = false, Active = true, SiteId = 44 },
        new TucClient { UcclId = 10, BranchId = Sydney, ClientTypeId = 2, UcclActive = true, UcclName = "Sydney Co" },
        new TucClient { UcclId = 20, BranchId = Melbourne, ClientTypeId = 2, UcclActive = true, UcclName = "Melbourne Co" },
        new TucClient { UcclId = 40, BranchId = null, ClientTypeId = 4, UcclActive = true, UcclName = "House" },
        new TucCourier { UccrId = 100, UccrName = "Syd", UccrSurname = "Driver", Code = "S1", Active = true, BranchId = Sydney },
        new TucCourier { UccrId = 200, UccrName = "Mel", UccrSurname = "Driver", Code = "M1", Active = true, BranchId = Melbourne });

    private static TblBulkJob BulkJob(int id, int client, int? run = null, int? courier = null, string? ourRef = null) => new()
    {
        BulkJobId = id, JobNumber = $"J{id}", BookDate = Day, BookTime = Day, ClientId = client, ClientCode = $"C{client}",
        Speed = 1, FromAddress = "F", ToAddress = "T", BulkRunId = run, CourierId = courier, OurRef = ourRef,
    };

    // ---- jobs ----

    [Fact]
    public async Task BulkJobList_ShowsOnlyJobsOfTheCallersBranches()
    {
        await World();
        await Seed(BulkJob(1, 20), BulkJob(2, 10), BulkJob(3, 40));

        var mine = await new JobService(Factory(), MelbourneGuard()).GetBulkJobsAsync(Day, null, null, null, null);
        var all = await new JobService(Factory(), CockpitTestDoubles.Unrestricted()).GetBulkJobsAsync(Day, null, null, null, null);

        Assert.Equal(new[] { 1, 3 }, mine.Select(j => j.BulkJobId).Order().ToArray());   // Melbourne's and the house account's
        Assert.Equal(new[] { 1, 2, 3 }, all.Select(j => j.BulkJobId).Order().ToArray());
    }

    [Fact]
    public async Task ClientFiltersAndOurRefs_AreNarrowedToTheCallersJobs()
    {
        await World();
        await Seed(BulkJob(1, 20, ourRef: "MELREF"), BulkJob(2, 10, ourRef: "SYDREF"));
        var svc = new JobService(Factory(), MelbourneGuard());

        var clients = await svc.GetClientFiltersAsync();
        var refs = await svc.GetOurRefsAsync(Day);

        Assert.Single(clients);
        Assert.Equal(new[] { "MELREF" }, refs.ToArray());
    }

    [Fact]
    public async Task JobDetailAndEdits_ForAJobOutsideTheCallersBranches_ReadAsNotFound()
    {
        await World();
        await Seed(BulkJob(1, 20), BulkJob(2, 10));
        var svc = new JobService(Factory(), MelbourneGuard());

        Assert.NotNull(await svc.GetJobDetailExtrasAsync(1));
        Assert.Null(await svc.GetJobDetailExtrasAsync(2));
        Assert.False(await svc.UpdateJobDetailAsync(2, "Qty", "5"));
        Assert.True(await svc.UpdateJobDetailAsync(1, "Qty", "5"));
        Assert.False(await svc.UpdateGpsAsync(new RoutedOperations.Core.Application.Dtos.Job.UpdateGpsRequest { JobId = 2, Address = "ToAddress" }));
        Assert.Empty(await svc.GetMultiboxChildrenAsync(2));
    }

    // ---- runs ----

    [Fact]
    public async Task RunList_AppliesTheRunRule_CourierTheirsShowsAll_AnyJobShowsOnlyTheirs_ForeignIsHidden_EmptyUnassignedStaysVisible()
    {
        await World();
        await Seed(
            new TblBulkRun { Id = 1, Name = "Mel courier", CourierId = 200, Status = 0 },
            new TblBulkRun { Id = 2, Name = "Mixed", CourierId = null, Status = 0 },
            new TblBulkRun { Id = 3, Name = "Sydney only", CourierId = 100, Status = 0 },
            new TblBulkRun { Id = 4, Name = "Fresh draft", CourierId = null, Status = 0, DespatchDateTime = Day },
            BulkJob(11, 10, run: 1), BulkJob(12, 20, run: 1),     // run 1: Melbourne's courier, jobs from both
            BulkJob(21, 20, run: 2), BulkJob(22, 10, run: 2),     // run 2: no courier, one job each
            BulkJob(31, 10, run: 3));                              // run 3: nothing of theirs

        var runs = await new RunService(Factory(), MelbourneGuard()).GetBulkRunsAsync(Day, null, null, null, null);

        Assert.Equal(new[] { 1, 2, 4 }, runs.Select(r => r.Id).Order().ToArray());
        Assert.Equal(new[] { 11, 12 }, runs.Single(r => r.Id == 1).Jobs.Select(j => j.BulkJobId).Order().ToArray());   // courier is theirs: every job
        Assert.Equal(new[] { 21 }, runs.Single(r => r.Id == 2).Jobs.Select(j => j.BulkJobId).ToArray());                // only their job
        Assert.Empty(runs.Single(r => r.Id == 4).Jobs);
    }

    [Fact]
    public async Task RunWrites_OnARunOrJobOutsideTheCallersBranches_AreRefusedAsNotFound()
    {
        await World();
        await Seed(
            new TblBulkRun { Id = 3, Name = "Sydney only", CourierId = 100, Status = 0 },
            new TblBulkRun { Id = 5, Name = "Mine", CourierId = 200, Status = 0 },
            BulkJob(31, 10, run: 3), BulkJob(51, 20, run: 5));
        var svc = new RunService(Factory(), MelbourneGuard());

        Assert.Equal("Failed", (await svc.DeleteAsync(3)).Result);
        Assert.Equal("Failed", (await svc.RemoveJobFromRunAsync(31)).Result);
        Assert.Equal("Failed", (await svc.UpdateJobToRunAsync(31, null, 5)).Result);       // a Sydney job onto their run
        Assert.Equal("Failed", (await svc.UpdateJobToRunAsync(51, null, 3)).Result);       // their job onto a Sydney run
        Assert.Equal("Failed", (await svc.SetJobStartEndAsync(3, 31, true, null)).Result);
        Assert.Equal("Failed", (await svc.AssignJobsToRunAsync(5, [new() { JobId = 31 }])).Result);

        await using var check = CockpitTestHarness.Context(_options);
        Assert.NotNull(await check.TblBulkRuns.FindAsync([3], Ct));   // nothing was deleted or moved
    }

    [Fact]
    public async Task ARunTheyCanActOn_StillWorks()
    {
        await World();
        await Seed(new TblBulkRun { Id = 5, Name = "Mine", CourierId = 200, Status = 0 }, BulkJob(51, 20, run: 5));

        var result = await new RunService(Factory(), MelbourneGuard()).DeleteAsync(5);

        Assert.Equal("Success", result.Result);
    }

    // ---- schedules: the client search and a client's own schedules ----

    private ScheduleService Schedules(IBranchScopeGuard guard)
    {
        var accessor = new HttpContextAccessor();
        var cache = new TenantScopedCache(new MemoryCache(new MemoryCacheOptions()), accessor);
        return new ScheduleService(Factory(), NullLogger<ScheduleService>.Instance, cache, Substitute.For<IScheduleConverter>(), accessor, guard);
    }

    [Fact]
    public async Task ScheduleClientSearch_FindsOnlyClientsTheCallerCanSee()
    {
        await World();
        await Seed(
            new TucClient { UcclId = 21, BranchId = Melbourne, ClientTypeId = 2, UcclActive = true, UcclName = "Co Two", UcclCode = "CO2" },
            new TucClient { UcclId = 11, BranchId = Sydney, ClientTypeId = 2, UcclActive = true, UcclName = "Co One", UcclCode = "CO1" });

        var found = await Schedules(MelbourneGuard()).SearchClientsAsync("Co");

        Assert.Contains(found, c => c.Id == 21);
        Assert.DoesNotContain(found, c => c.Id == 11);
        Assert.DoesNotContain(found, c => c.Id == 10);   // Sydney Co
    }

    [Fact]
    public async Task SchedulesForAClientOutsideTheCallersBranches_AreEmpty()
    {
        await World();

        Assert.Empty(await Schedules(MelbourneGuard()).GetSchedulesForClientAsync(10));
    }

    [Fact]
    public async Task WhereClientVisible_NarrowsAClientQueryInSql_KeepingHouseAccounts()
    {
        await World();
        await using var context = CockpitTestHarness.Context(_options);

        var ids = await (await MelbourneGuard().WhereClientVisibleAsync(context.TucClients)).Select(c => c.UcclId).OrderBy(i => i).ToListAsync(Ct);

        Assert.Equal(new[] { 20, 40 }, ids);
    }

    // ---- couriers and the cache ----

    [Fact]
    public async Task CourierList_IsNarrowedAfterTheCache_SoOneUsersViewNeverLeaksToTheNext()
    {
        await World();
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext());
        var cache = new TenantScopedCache(new MemoryCache(new MemoryCacheOptions()), accessor);

        var melbourne = await new CourierService(Factory(), cache, MelbourneGuard()).GetActiveAsync();
        var everyone = await new CourierService(Factory(), cache, CockpitTestDoubles.Unrestricted()).GetActiveAsync();

        Assert.Equal(new[] { 200 }, melbourne.Select(c => c.CourierId).ToArray());
        Assert.Equal(new[] { 100, 200 }, everyone.Select(c => c.CourierId).Order().ToArray());   // the cache was not poisoned
    }

    // ---- bulk import client scope ----

    private BulkClientScope StaffScope(IBranchScopeGuard? guard)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("ClientTypeId", "4"), new Claim("IsNetworkPartner", "False")], "test"))
        });
        return new BulkClientScope(accessor, guard);
    }

    private static IBranchScopeGuard RestrictedGuard(bool defaultInScope = false)
    {
        var guard = Substitute.For<IBranchScopeGuard>();
        guard.IsRestricted.Returns(true);
        guard.BranchIds.Returns([Melbourne]);
        guard.DefaultBranchInScope.Returns(defaultInScope);
        return guard;
    }

    [Fact]
    public async Task BulkImportClients_StaffWithBranches_ActOnlyForTheirBranchesClientsAndHouseAccounts()
    {
        await World();
        await using var context = CockpitTestHarness.Context(_options);
        var scope = StaffScope(RestrictedGuard());

        var ids = await scope.ActForClientIdsAsync(context, contactId: 1);

        Assert.NotNull(ids);
        Assert.Equal(new[] { 20, 40 }, ids!.Order().ToArray());
        Assert.True(await scope.CanActForClientAsync(context, 1, 20));
        Assert.False(await scope.CanActForClientAsync(context, 1, 10));
        Assert.Equal(new[] { 20, 40 }, context.TucClients.Where(scope.CanSee(1)).Select(c => c.UcclId).OrderBy(i => i).ToArray());
    }

    [Fact]
    public async Task BulkImportClients_AClientWithNoBranch_BelongsToTheDefaultBranch()
    {
        await World();
        await Seed(new TucClient { UcclId = 50, BranchId = null, ClientTypeId = 2, UcclActive = true, UcclName = "No branch" });
        await using var context = CockpitTestHarness.Context(_options);

        var holdsDefault = await StaffScope(RestrictedGuard(defaultInScope: true)).ActForClientIdsAsync(context, 1);
        var doesNot = await StaffScope(RestrictedGuard(defaultInScope: false)).ActForClientIdsAsync(context, 1);

        Assert.Contains(50, holdsDefault!);
        Assert.DoesNotContain(50, doesNot!);
    }

    [Fact]
    public async Task BulkImportClients_StaffWithNoBranches_AreUnrestricted_AsBefore()
    {
        await World();
        await using var context = CockpitTestHarness.Context(_options);

        Assert.Null(await StaffScope(null).ActForClientIdsAsync(context, 1));
        Assert.Null(await StaffScope(CockpitTestDoubles.Unrestricted()).ActForClientIdsAsync(context, 1));
    }

    // ---- pickers and rosters ----

    [Fact]
    public async Task RouteAssignableCouriers_AreNarrowedToTheCallersBranches()
    {
        await World();
        var accessor = Substitute.For<IHttpContextAccessor>();

        var targets = await new RecurringRouteService(Factory(), accessor, MelbourneGuard()).GetAssignableTargetsAsync();

        Assert.Equal(new[] { 200 }, targets.Couriers.Select(c => c.Id).ToArray());
    }

    [Fact]
    public async Task RouteRoster_DropsCourierEntriesOutsideTheCallersBranches_ButKeepsAgentEntries()
    {
        await World();
        await Seed(
            new DispatchRouteRoster { RouteRosterId = 1, RouteId = 9, TargetType = 1, CourierId = 200, IsActive = true, CreatedAt = Day },
            new DispatchRouteRoster { RouteRosterId = 2, RouteId = 9, TargetType = 1, CourierId = 100, IsActive = true, CreatedAt = Day },
            new DispatchRouteRoster { RouteRosterId = 3, RouteId = 9, TargetType = 2, AgentId = 5, IsActive = true, CreatedAt = Day });

        var roster = await new RecurringRouteService(Factory(), Substitute.For<IHttpContextAccessor>(), MelbourneGuard()).GetRosterAsync(9);

        Assert.Equal(new[] { 1, 3 }, roster.Select(r => r.RouteRosterId).Order().ToArray());
    }

    [Fact]
    public async Task LinehaulCourierLookup_IsNarrowedToTheCallersBranches()
    {
        await World();

        var lookups = await new RecurringLinehaulService(Factory(), MelbourneGuard()).GetLookupsAsync();

        Assert.Equal(new[] { 200 }, lookups.Couriers.Select(c => c.Id).ToArray());
    }
}

internal static class CockpitTestDoubles
{
    internal static IBranchScopeGuard Unrestricted() => BranchTestDoubles.Unrestricted();
}
