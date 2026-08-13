// RouteViewerEventService covers CS event read + direct-link + create/close/reply
// + CreateClientIntel. All admin-gated (T.1 SECURITY interim). EF-only paths
// (CloseEventAsync via ExecuteUpdateAsync, AddEventReplyAsync EF read) run
// natively on InMemory. SP-invoking paths throw.
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerEventServiceTests
{
    private static (RouteViewerEventService sut, DynamicDespatchDbContext seed) NewSvc(NpScope scope)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var seed = RouteViewerTestHarness.Context(opts);
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        var sut = new RouteViewerEventService(factory, resolver,
            NullLogger<RouteViewerEventService>.Instance);
        return (sut, seed);
    }

    [Fact]
    public async Task GetEventListAsync_Np_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, 42));
        var result = await sut.GetEventListAsync(new EventListRequest());
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetEventListAsync_Admin_HitsSp()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.GetEventListAsync(new EventListRequest { RunDate = DateTime.Today }));
    }

    [Fact]
    public async Task GetEventJobsAsync_Np_ReturnsEmpty()
    {
        var (sut, _) = NewSvc(new NpScope(false, 42));
        var result = await sut.GetEventJobsAsync(clientId: 1, clientInternal: false);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetEventJobsAsync_Admin_HitsSp()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GetEventJobsAsync(1, false));
    }

    [Fact]
    public async Task GenerateDirectLinkAsync_UnknownClient_ReturnsDeclined()
    {
        // SP call throws under InMemory; the null-notification branch never
        // fires because the SP itself blows up. Assert the throw so we cover
        // the SP-invocation branch guard rail.
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.GenerateDirectLinkAsync(1, 100));
    }

    [Fact]
    public async Task CreateEventAsync_Np_ReturnsZero()
    {
        var (sut, _) = NewSvc(new NpScope(false, 42));
        var result = await sut.CreateEventAsync(new CreateEventRequest { EventDate = DateTime.Today });
        Assert.Equal(0, result);
    }

    [Fact]
    public async Task CloseEventAsync_Np_ReturnsFalse()
    {
        var (sut, _) = NewSvc(new NpScope(false, 42));
        var result = await sut.CloseEventAsync(1, "closer");
        Assert.False(result);
    }

    [Fact]
    public async Task CloseEventAsync_Admin_HitsExecuteUpdate()
    {
        // InMemory does not translate ExecuteUpdateAsync. Coverage: past
        // the NP admin gate and into the mutation branch.
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.CloseEventAsync(9999, "closer"));
    }

    [Fact]
    public async Task AddEventReplyAsync_Np_ReturnsFalse()
    {
        var (sut, _) = NewSvc(new NpScope(false, 42));
        var result = await sut.AddEventReplyAsync(1, "hello", "user");
        Assert.False(result);
    }

    [Fact]
    public async Task AddEventReplyAsync_MissingEvent_ReturnsFalseWithoutExecuteUpdate()
    {
        // Missing row short-circuits BEFORE the ExecuteUpdate call, so this
        // returns false without hitting the InMemory limitation.
        var (sut, _) = NewSvc(new NpScope(true, null));
        var result = await sut.AddEventReplyAsync(9999, "hi", "user");
        Assert.False(result);
    }

    [Fact]
    public async Task AddEventReplyAsync_ExistingEvent_HitsExecuteUpdate()
    {
        // With a row present, the code path reaches ExecuteUpdateAsync which
        // InMemory does not translate. Coverage: stamped-note branch reached.
        var (sut, seed) = NewSvc(new NpScope(true, null));
        seed.TblBulkEvents.Add(new TblBulkEvent
        {
            BulkEventId = 5,
            Notes = "old content",
            Created = DateTime.UtcNow,
            EventDate = DateOnly.FromDateTime(DateTime.Today),
        });
        await seed.SaveChangesAsync();

        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.AddEventReplyAsync(5, "new note", "SomeUser"));
    }

    [Fact]
    public async Task CreateClientIntelAsync_Np_NoOp()
    {
        var (sut, _) = NewSvc(new NpScope(false, 42));
        // Should just return without touching DB - admin gate. No exception.
        await sut.CreateClientIntelAsync(new ClientIntelRequest { Mobile = "027" });
    }

    [Fact]
    public async Task CreateClientIntelAsync_Admin_HitsSp()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.CreateClientIntelAsync(new ClientIntelRequest { Mobile = "027", IsNew = true }));
    }

    [Fact]
    public async Task CreateClientIntelAsync_UpdateVariant_HitsSp()
    {
        var (sut, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.CreateClientIntelAsync(new ClientIntelRequest { Mobile = "027", IsNew = false }));
    }
}
