using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Branches;

// INpScopeGuard is registered as NpAndBranchScopeGuard, so every existing NP
// guard call site also runs the branch guard. These tests pin that wiring.
public class NpAndBranchScopeGuardTests
{
    private static (NpAndBranchScopeGuard Sut, IBranchScopeGuard Branch) Build()
    {
        // Admin NP scope: the NP half is a no-op, so only the branch half acts.
        var npResolver = Substitute.For<INpScopeResolver>();
        npResolver.ResolveAsync().Returns(new NpScope(IsAdmin: true, NpAgentId: null));
        var np = new NpScopeGuard(npResolver, Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>());
        var branch = Substitute.For<IBranchScopeGuard>();
        return (new NpAndBranchScopeGuard(np, branch), branch);
    }

    [Fact]
    public async Task EveryMethod_CallsBranchGuard()
    {
        var (sut, branch) = Build();

        await sut.EnsureTucJobInScopeAsync(1);
        await sut.EnsureBulkJobInScopeAsync(2);
        await sut.EnsureTucJobByNumberInScopeAsync("J-3");
        await sut.EnsureRouteInScopeAsync(4);
        await sut.EnsureRunInScopeAsync(5);

        await branch.Received(1).EnsureTucJobInScopeAsync(1);
        await branch.Received(1).EnsureBulkJobInScopeAsync(2);
        await branch.Received(1).EnsureTucJobByNumberInScopeAsync("J-3");
        await branch.Received(1).EnsureRouteInScopeAsync(4);
        await branch.Received(1).EnsureRunInScopeAsync(5);
    }

    [Fact]
    public async Task BranchDenial_Propagates()
    {
        var (sut, branch) = Build();
        branch.EnsureTucJobInScopeAsync(1).Returns<Task>(_ => throw new BranchScopeException("tucJob 1 is outside your branches."));

        await Assert.ThrowsAsync<BranchScopeException>(() => sut.EnsureTucJobInScopeAsync(1));
    }

    [Fact]
    public async Task NpDenial_ShortCircuitsBeforeBranch()
    {
        var npResolver = Substitute.For<INpScopeResolver>();
        npResolver.ResolveAsync().Returns(new NpScope(IsAdmin: false, NpAgentId: 42));
        var ctx = new DynamicDespatchDbContext(new DbContextOptionsBuilder<DynamicDespatchDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContextAsync().Returns(ctx);
        var branch = Substitute.For<IBranchScopeGuard>();
        var sut = new NpAndBranchScopeGuard(new NpScopeGuard(npResolver, factory), branch);

        await Assert.ThrowsAsync<NpLabelScopeException>(() => sut.EnsureTucJobInScopeAsync(999));
        await branch.DidNotReceive().EnsureTucJobInScopeAsync(Arg.Any<int>());
    }
}
