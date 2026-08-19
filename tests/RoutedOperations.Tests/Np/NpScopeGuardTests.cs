using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Np;

public class NpScopeGuardTests
{
    private static DynamicDespatchDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<DynamicDespatchDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new DynamicDespatchDbContext(options);
    }

    private static IDbContextFactory<DynamicDespatchDbContext> FactoryFor(DynamicDespatchDbContext ctx)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContextAsync().Returns(ctx);
        return factory;
    }

    private static INpScopeResolver ResolverReturning(NpScope scope)
    {
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        return resolver;
    }

    // ---- EnsureTucJobInScopeAsync ----

    [Fact]
    public async Task EnsureTucJobInScopeAsync_AdminScope_NoOp()
    {
        var resolver = ResolverReturning(new NpScope(IsAdmin: true, NpAgentId: null));
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeGuard(resolver, factory);

        await sut.EnsureTucJobInScopeAsync(999);

        await factory.DidNotReceive().CreateDbContextAsync();
    }

    [Fact]
    public async Task EnsureTucJobInScopeAsync_MatchingAgent_Passes()
    {
        await using var ctx = NewContext();
        ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "J-1", NpAgentId = 42, UcjbVoid = false });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        await sut.EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task EnsureTucJobInScopeAsync_MismatchedAgent_Throws()
    {
        await using var ctx = NewContext();
        ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "J-1", NpAgentId = 99, UcjbVoid = false });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        var ex = await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.EnsureTucJobInScopeAsync(1));
        Assert.Contains("tucJob 1", ex.Message);
    }

    [Fact]
    public async Task EnsureTucJobInScopeAsync_JobMissing_ThrowsWhenScopeIsNp()
    {
        // FirstOrDefaultAsync returns default (null for int?), which does
        // not equal a non-null NpAgentId -> the guard throws.
        await using var ctx = NewContext();
        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.EnsureTucJobInScopeAsync(999));
    }

    // ---- EnsureBulkJobInScopeAsync ----

    [Fact]
    public async Task EnsureBulkJobInScopeAsync_AdminScope_NoOp()
    {
        var resolver = ResolverReturning(new NpScope(IsAdmin: true, NpAgentId: null));
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeGuard(resolver, factory);

        await sut.EnsureBulkJobInScopeAsync(999);

        await factory.DidNotReceive().CreateDbContextAsync();
    }

    [Fact]
    public async Task EnsureBulkJobInScopeAsync_MatchingAgent_Passes()
    {
        // NpAgentId now sourced from tucJob (reached via TblBulkJob.JobId).
        await using var ctx = NewContext();
        ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobId = 10 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "J-10", NpAgentId = 42 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        await sut.EnsureBulkJobInScopeAsync(5);
    }

    [Fact]
    public async Task EnsureBulkJobInScopeAsync_MismatchedAgent_Throws()
    {
        await using var ctx = NewContext();
        ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobId = 10 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "J-10", NpAgentId = 99 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        var ex = await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.EnsureBulkJobInScopeAsync(5));
        Assert.Contains("tblBulkJob 5", ex.Message);
    }

    [Fact]
    public async Task EnsureBulkJobInScopeAsync_AdHocAssignment_TucJobStamped_BulkJobNull_Passes()
    {
        // Regression: ad-hoc NP assignment via the 3-way Assign Route
        // picker stamps only tucJob.NpAgentId, not tblBulkJob.NpAgentId.
        // Guard must reach through to tucJob and let the NP through
        // even when the bulk-job column is NULL.
        await using var ctx = NewContext();
        ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobId = 10, NpAgentId = null });
        ctx.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "J-10", NpAgentId = 42 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        await sut.EnsureBulkJobInScopeAsync(5);
    }

    // ---- EnsureTucJobByNumberInScopeAsync ----

    [Fact]
    public async Task EnsureTucJobByNumberInScopeAsync_AdminScope_NoOp()
    {
        var resolver = ResolverReturning(new NpScope(IsAdmin: true, NpAgentId: null));
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeGuard(resolver, factory);

        await sut.EnsureTucJobByNumberInScopeAsync("does-not-matter");

        await factory.DidNotReceive().CreateDbContextAsync();
    }

    [Fact]
    public async Task EnsureTucJobByNumberInScopeAsync_AllMatch_Passes()
    {
        await using var ctx = NewContext();
        ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "J-1", NpAgentId = 42 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "J-1", NpAgentId = 42 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        await sut.EnsureTucJobByNumberInScopeAsync("J-1");
    }

    [Fact]
    public async Task EnsureTucJobByNumberInScopeAsync_AnyMismatch_Throws()
    {
        await using var ctx = NewContext();
        ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "J-1", NpAgentId = 42 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "J-1", NpAgentId = 99 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        var ex = await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.EnsureTucJobByNumberInScopeAsync("J-1"));
        Assert.Contains("J-1", ex.Message);
    }

    [Fact]
    public async Task EnsureTucJobByNumberInScopeAsync_NoRowsWithNumber_Passes()
    {
        await using var ctx = NewContext();
        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        // No rows -> AnyAsync returns false -> no throw.
        await sut.EnsureTucJobByNumberInScopeAsync("missing");
    }

    // ---- EnsureRouteInScopeAsync ----

    [Fact]
    public async Task EnsureRouteInScopeAsync_AdminScope_NoOp()
    {
        var resolver = ResolverReturning(new NpScope(IsAdmin: true, NpAgentId: null));
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeGuard(resolver, factory);

        await sut.EnsureRouteInScopeAsync(3);

        await factory.DidNotReceive().CreateDbContextAsync();
    }

    [Fact]
    public async Task EnsureRouteInScopeAsync_AllJobsMatch_Passes()
    {
        await using var ctx = NewContext();
        ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "J-1", NpAgentId = 42, UcjbVoid = false, RouteId = 3 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "J-2", NpAgentId = 42, UcjbVoid = false, RouteId = 3 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        await sut.EnsureRouteInScopeAsync(3);
    }

    [Fact]
    public async Task EnsureRouteInScopeAsync_MixedTenantRoute_Throws()
    {
        await using var ctx = NewContext();
        ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "J-1", NpAgentId = 42, UcjbVoid = false, RouteId = 3 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "J-2", NpAgentId = 99, UcjbVoid = false, RouteId = 3 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        var ex = await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.EnsureRouteInScopeAsync(3));
        Assert.Contains("Route 3", ex.Message);
    }

    [Fact]
    public async Task EnsureRouteInScopeAsync_VoidJobsIgnored()
    {
        // The void mismatched job should NOT cause a throw because the
        // predicate excludes UcjbVoid == true.
        await using var ctx = NewContext();
        ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "J-1", NpAgentId = 42, UcjbVoid = false, RouteId = 3 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "J-2", NpAgentId = 99, UcjbVoid = true, RouteId = 3 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        await sut.EnsureRouteInScopeAsync(3);
    }

    // ---- EnsureRunInScopeAsync ----

    [Fact]
    public async Task EnsureRunInScopeAsync_AdminScope_NoOp()
    {
        var resolver = ResolverReturning(new NpScope(IsAdmin: true, NpAgentId: null));
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        var sut = new NpScopeGuard(resolver, factory);

        await sut.EnsureRunInScopeAsync(-3);
        await sut.EnsureRunInScopeAsync(5);

        await factory.DidNotReceive().CreateDbContextAsync();
    }

    [Fact]
    public async Task EnsureRunInScopeAsync_NegativeRunId_DelegatesToRouteGuard()
    {
        // Negative runId N means route id -N. Seed a mixed-tenant route for
        // route id 3 and pass runId -3 - the mismatched job should still
        // trigger a throw because the negative path calls EnsureRouteInScopeAsync(3).
        await using var ctx = NewContext();
        ctx.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "J-1", NpAgentId = 42, UcjbVoid = false, RouteId = 3 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "J-2", NpAgentId = 99, UcjbVoid = false, RouteId = 3 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        var ex = await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.EnsureRunInScopeAsync(-3));
        Assert.Contains("Route 3", ex.Message);
    }

    [Fact]
    public async Task EnsureRunInScopeAsync_PositiveRunId_AllJobsMatch_Passes()
    {
        // NpAgentId sourced from tucJob (through TblBulkJob.JobId).
        await using var ctx = NewContext();
        ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 100, JobId = 200 });
        ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 101, JobId = 201 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 200, UcjbNumber = "J-200", NpAgentId = 42 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 201, UcjbNumber = "J-201", NpAgentId = 42 });
        ctx.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, RunId = 7, BulkJobId = 100 });
        ctx.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 2, RunId = 7, BulkJobId = 101 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        await sut.EnsureRunInScopeAsync(7);
    }

    [Fact]
    public async Task EnsureRunInScopeAsync_PositiveRunId_MixedTenant_Throws()
    {
        await using var ctx = NewContext();
        ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 100, JobId = 200 });
        ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 101, JobId = 201 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 200, UcjbNumber = "J-200", NpAgentId = 42 });
        ctx.TucJobs.Add(new TucJob { UcjbId = 201, UcjbNumber = "J-201", NpAgentId = 99 });
        ctx.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, RunId = 7, BulkJobId = 100 });
        ctx.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 2, RunId = 7, BulkJobId = 101 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        var ex = await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.EnsureRunInScopeAsync(7));
        Assert.Contains("Run 7", ex.Message);
    }

    [Fact]
    public async Task EnsureRunInScopeAsync_PositiveRunId_EmptyRun_Passes()
    {
        // No jobs on the run -> Join is empty -> AnyAsync false -> no throw.
        await using var ctx = NewContext();
        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        await sut.EnsureRunInScopeAsync(7);
    }

    [Fact]
    public async Task EnsureRunInScopeAsync_PositiveRunId_AdHocAssignment_BulkJobNull_Passes()
    {
        // Regression: prebook path leaves tblBulkJob.NpAgentId NULL for
        // ad-hoc NP assignments; guard must still permit the run for the
        // right NP by reading NpAgentId from tucJob.
        await using var ctx = NewContext();
        ctx.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 100, JobId = 200, NpAgentId = null });
        ctx.TucJobs.Add(new TucJob { UcjbId = 200, UcjbNumber = "J-200", NpAgentId = 42 });
        ctx.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, RunId = 7, BulkJobId = 100 });
        await ctx.SaveChangesAsync();

        var resolver = ResolverReturning(new NpScope(IsAdmin: false, NpAgentId: 42));
        var sut = new NpScopeGuard(resolver, FactoryFor(ctx));

        await sut.EnsureRunInScopeAsync(7);
    }
}
