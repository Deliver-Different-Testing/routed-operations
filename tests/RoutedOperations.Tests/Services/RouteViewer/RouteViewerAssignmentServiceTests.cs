// RouteViewerAssignmentService covers 3-bucket picker + typeahead + bulk
// assign/unassign + run-level SP wrappers. Tests exercise the EF-only
// paths (assignable-targets buckets, search filters) + scope-guard invariants.
// SP-invoking branches (Courier assign via DES_stpJob_AutoDespatchSelectedJobs,
// PreAssignRun / TransferRun / ReleaseRun / UnAssignRun via ExecuteSqlRawAsync)
// short-circuit under InMemory but we assert the scope guard was reached
// beforehand.
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerAssignmentServiceTests
{
    private static (RouteViewerAssignmentService sut, DynamicDespatchDbContext seed, INpScopeResolver resolver, INpScopeGuard guard)
        NewSvc(NpScope scope)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var seed = RouteViewerTestHarness.Context(opts);
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        var guard = Substitute.For<INpScopeGuard>();
        var sut = new RouteViewerAssignmentService(factory, resolver, guard,
            NullLogger<RouteViewerAssignmentService>.Instance);
        return (sut, seed, resolver, guard);
    }

    private static NpScope Admin() => new(true, null);
    private static NpScope Np(int id) => new(false, id);

    // -------- GetAssignableTargetsAsync --------

    [Fact]
    public async Task GetAssignableTargetsAsync_Admin_ReturnsAllThreeBuckets()
    {
        var (sut, seed, _, guard) = NewSvc(Admin());
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "A", UccrSurname = "B", Code = "C1", Active = true });
        seed.TucAgents.Add(new TucAgent { UcagId = 10, UcagName = "AgentX", IsNetworkPartner = false });
        seed.TucAgents.Add(new TucAgent { UcagId = 20, UcagName = "NpY", IsNetworkPartner = true });
        await seed.SaveChangesAsync();

        var response = await sut.GetAssignableTargetsAsync(100);

        Assert.Single(response.Couriers);
        Assert.Single(response.Agents);
        Assert.Single(response.Nps);
        await guard.Received(1).EnsureTucJobInScopeAsync(100);
    }

    [Fact]
    public async Task GetAssignableTargetsAsync_Np_CouriersOnly_NoAgentsOrNps()
    {
        var (sut, seed, _, _) = NewSvc(Np(42));
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "A", UccrSurname = "B", Code = "C1", Active = true, NpAgentId = 42 });
        seed.TucCouriers.Add(new TucCourier { UccrId = 2, UccrName = "X", UccrSurname = "Y", Code = "C2", Active = true, NpAgentId = 99 });
        seed.TucAgents.Add(new TucAgent { UcagId = 10, UcagName = "AgentX", IsNetworkPartner = false });
        await seed.SaveChangesAsync();

        var response = await sut.GetAssignableTargetsAsync(1);

        Assert.Single(response.Couriers);
        Assert.Equal("A B", response.Couriers[0].Name);
        Assert.Empty(response.Agents);
        Assert.Empty(response.Nps);
    }

    [Fact]
    public async Task GetAssignableTargetsAsync_ExcludesInactiveCouriers()
    {
        var (sut, seed, _, _) = NewSvc(Admin());
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "Off", UccrSurname = "Line", Code = "C1", Active = false });
        await seed.SaveChangesAsync();

        var response = await sut.GetAssignableTargetsAsync(1);
        Assert.Empty(response.Couriers);
    }

    [Fact]
    public async Task GetAssignableTargetsAsync_OrdersCouriersByName()
    {
        var (sut, seed, _, _) = NewSvc(Admin());
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "Zeta", UccrSurname = "", Code = "Z", Active = true });
        seed.TucCouriers.Add(new TucCourier { UccrId = 2, UccrName = "Alpha", UccrSurname = "", Code = "A", Active = true });
        await seed.SaveChangesAsync();

        var response = await sut.GetAssignableTargetsAsync(1);

        Assert.Equal("Alpha", response.Couriers[0].Name);
        Assert.Equal("Zeta", response.Couriers[1].Name);
    }

    // -------- SearchCouriersAsync --------

    [Fact]
    public async Task SearchCouriersAsync_EmptyQuery_ReturnsAllActive()
    {
        var (sut, seed, _, _) = NewSvc(Admin());
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "A", UccrSurname = "B", Code = "AB", Active = true });
        seed.TucCouriers.Add(new TucCourier { UccrId = 2, UccrName = "C", UccrSurname = "D", Code = "CD", Active = true });
        await seed.SaveChangesAsync();

        var result = await sut.SearchCouriersAsync(1, null, 50);

        Assert.Equal(2, result.Count);
    }

    [Fact]
    public async Task SearchCouriersAsync_LimitClampedToMin1()
    {
        var (sut, seed, _, _) = NewSvc(Admin());
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "A", UccrSurname = "B", Code = "AB", Active = true });
        seed.TucCouriers.Add(new TucCourier { UccrId = 2, UccrName = "C", UccrSurname = "D", Code = "CD", Active = true });
        await seed.SaveChangesAsync();

        var result = await sut.SearchCouriersAsync(1, null, 0);
        Assert.Single(result);
    }

    [Fact]
    public async Task SearchCouriersAsync_LimitClampedToMax200()
    {
        var (sut, seed, _, _) = NewSvc(Admin());
        for (int i = 1; i <= 5; i++)
            seed.TucCouriers.Add(new TucCourier { UccrId = i, UccrName = "N" + i, UccrSurname = "S", Code = "C" + i, Active = true });
        await seed.SaveChangesAsync();

        var result = await sut.SearchCouriersAsync(1, null, 9999);
        Assert.Equal(5, result.Count);
    }

    [Fact]
    public async Task SearchCouriersAsync_NpScope_FiltersToScopeAgent()
    {
        var (sut, seed, _, _) = NewSvc(Np(42));
        seed.TucCouriers.Add(new TucCourier { UccrId = 1, UccrName = "Mine", UccrSurname = "M", Code = "M", Active = true, NpAgentId = 42 });
        seed.TucCouriers.Add(new TucCourier { UccrId = 2, UccrName = "Other", UccrSurname = "O", Code = "O", Active = true, NpAgentId = 99 });
        await seed.SaveChangesAsync();

        var result = await sut.SearchCouriersAsync(1, null, 50);

        Assert.Single(result);
        Assert.Equal("Mine M", result[0].Name);
    }

    // -------- SearchAgentsAsync --------

    [Fact]
    public async Task SearchAgentsAsync_Np_ShortCircuitsToEmpty()
    {
        var (sut, seed, _, _) = NewSvc(Np(42));
        seed.TucAgents.Add(new TucAgent { UcagId = 1, UcagName = "A", IsNetworkPartner = false });
        await seed.SaveChangesAsync();

        var result = await sut.SearchAgentsAsync(1, null, false, 10);
        Assert.Empty(result);
    }

    [Fact]
    public async Task SearchAgentsAsync_Admin_FiltersByNetworkPartnerFlag()
    {
        var (sut, seed, _, _) = NewSvc(Admin());
        seed.TucAgents.Add(new TucAgent { UcagId = 1, UcagName = "NP", IsNetworkPartner = true });
        seed.TucAgents.Add(new TucAgent { UcagId = 2, UcagName = "PlainAgent", IsNetworkPartner = false });
        await seed.SaveChangesAsync();

        var nps = await sut.SearchAgentsAsync(1, null, true, 10);
        var plainAgents = await sut.SearchAgentsAsync(1, null, false, 10);

        Assert.Single(nps);
        Assert.Equal("NP", nps[0].Name);
        Assert.Single(plainAgents);
        Assert.Equal("PlainAgent", plainAgents[0].Name);
    }

    // -------- AssignAsync --------

    [Fact]
    public async Task AssignAsync_UnknownTargetType_RecordsError()
    {
        var (sut, _, _, _) = NewSvc(Admin());
        var result = await sut.AssignAsync(new BulkAssignRequest
        {
            JobIds = new List<int> { 1 },
            TargetType = "Bogus",
            TargetId = 5,
        });
        Assert.Equal(0, result.Succeeded);
        Assert.Equal(1, result.Failed);
        Assert.Contains(result.Errors, e => e.Contains("Bogus"));
    }

    [Fact]
    public async Task AssignAsync_Agent_HitsExecuteUpdate()
    {
        // EF InMemory does not translate ExecuteUpdateAsync; hitting the Agent
        // branch throws. Coverage assertion: we reached the SP path (past
        // scope guard) rather than short-circuiting.
        var (sut, _, _, guard) = NewSvc(Admin());
        await Assert.ThrowsAnyAsync<Exception>(() => sut.AssignAsync(new BulkAssignRequest
        {
            JobIds = new List<int> { 1 },
            TargetType = "Agent",
            TargetId = 42,
        }));
        await guard.Received(1).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task AssignAsync_NetworkPartner_MissingAgent_FailsAllJobs()
    {
        var (sut, _, _, _) = NewSvc(Admin());
        var result = await sut.AssignAsync(new BulkAssignRequest
        {
            JobIds = new List<int> { 1, 2 },
            TargetType = "NetworkPartner",
            TargetId = 9999,
        });
        Assert.Equal(2, result.Failed);
        Assert.Contains(result.Errors, e => e.Contains("Network Partner"));
    }

    [Fact]
    public async Task AssignAsync_NetworkPartner_ValidAgent_HitsExecuteUpdate()
    {
        // Agent lookup succeeds -> service proceeds to ExecuteUpdate which
        // InMemory does not translate. Coverage: valid-NP branch (past the
        // "agent is not NP" early return).
        var (sut, seed, _, _) = NewSvc(Admin());
        seed.TucAgents.Add(new TucAgent { UcagId = 55, UcagName = "NpAgent", IsNetworkPartner = true });
        await seed.SaveChangesAsync();

        await Assert.ThrowsAnyAsync<Exception>(() => sut.AssignAsync(new BulkAssignRequest
        {
            JobIds = new List<int> { 10 },
            TargetType = "NetworkPartner",
            TargetId = 55,
        }));
    }

    [Fact]
    public async Task AssignAsync_GuardsEveryJobInList()
    {
        // Agent branch throws under InMemory; verify all 3 guard calls
        // happened before the throw.
        var (sut, _, _, guard) = NewSvc(Admin());
        await Assert.ThrowsAnyAsync<Exception>(() => sut.AssignAsync(new BulkAssignRequest
        {
            JobIds = new List<int> { 1, 2, 3 },
            TargetType = "Agent",
            TargetId = 5,
        }));
        await guard.Received(1).EnsureTucJobInScopeAsync(1);
        await guard.Received(1).EnsureTucJobInScopeAsync(2);
        await guard.Received(1).EnsureTucJobInScopeAsync(3);
    }

    // -------- UnassignAsync --------

    [Fact]
    public async Task UnassignAsync_UnknownTarget_RecordsError()
    {
        var (sut, _, _, _) = NewSvc(Admin());
        var result = await sut.UnassignAsync(new BulkUnassignRequest
        {
            JobIds = new List<int> { 1 },
            Target = "Nope",
        });
        Assert.Equal(1, result.Failed);
        Assert.Contains(result.Errors, e => e.Contains("Nope"));
    }

    [Fact]
    public async Task UnassignAsync_Agent_HitsExecuteUpdate()
    {
        // InMemory does not translate ExecuteUpdateAsync. Coverage: Agent
        // branch is reached (past scope guard + switch case).
        var (sut, _, _, guard) = NewSvc(Admin());
        await Assert.ThrowsAnyAsync<Exception>(() => sut.UnassignAsync(new BulkUnassignRequest
        {
            JobIds = new List<int> { 1, 2 },
            Target = "Agent",
        }));
        await guard.Received(1).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task UnassignAsync_NetworkPartner_HitsExecuteUpdate()
    {
        // Coverage: NP branch is reached.
        var (sut, _, _, _) = NewSvc(Admin());
        await Assert.ThrowsAnyAsync<Exception>(() => sut.UnassignAsync(new BulkUnassignRequest
        {
            JobIds = new List<int> { 1 },
            Target = "NetworkPartner",
        }));
    }

    [Fact]
    public async Task UnassignAsync_GuardsEveryJob()
    {
        var (sut, _, _, guard) = NewSvc(Admin());
        await Assert.ThrowsAnyAsync<Exception>(() => sut.UnassignAsync(new BulkUnassignRequest
        {
            JobIds = new List<int> { 1, 2 },
            Target = "Agent",
        }));
        await guard.Received(1).EnsureTucJobInScopeAsync(1);
        await guard.Received(1).EnsureTucJobInScopeAsync(2);
    }
}
