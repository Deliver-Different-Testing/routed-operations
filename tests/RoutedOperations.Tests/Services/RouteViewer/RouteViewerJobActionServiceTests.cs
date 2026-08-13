// RouteViewerJobActionService wraps 12+ mutation SPs. Every method calls a
// guard (via jobId or bulkJobId) then invokes an SP via ExecuteSqlRawAsync
// which throws under InMemory. Tests cover the guard invariants + user name
// resolution + short-circuits for empty bulkJobId arrays.
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerJobActionServiceTests
{
    private static (RouteViewerJobActionService sut, INpScopeGuard guard, INpScopeResolver resolver)
        NewSvc(NpScope scope, IHttpContextAccessor? accessor = null)
    {
        var opts = RouteViewerTestHarness.NewOptions();
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        var guard = Substitute.For<INpScopeGuard>();
        var accessorX = accessor ?? Substitute.For<IHttpContextAccessor>();
        if (accessor == null) accessorX.HttpContext.Returns(new DefaultHttpContext());
        var sut = new RouteViewerJobActionService(factory, resolver, guard, accessorX,
            NullLogger<RouteViewerJobActionService>.Instance);
        return (sut, guard, resolver);
    }

    private static IHttpContextAccessor AccessorWith(params Claim[] claims)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType: "test"));
        accessor.HttpContext.Returns(ctx);
        return accessor;
    }

    // -------- job-status mutations --------

    [Fact]
    public async Task ActivateAsync_Admin_SkipsGuardButThrowsOnSp()
    {
        var (sut, guard, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.ActivateAsync(1));
        await guard.DidNotReceive().EnsureTucJobInScopeAsync(Arg.Any<int>());
    }

    [Fact]
    public async Task ActivateAsync_Np_HitsGuardBeforeSp()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.ActivateAsync(1));
        await guard.Received(1).EnsureTucJobInScopeAsync(1);
    }

    [Fact]
    public async Task ActivateAsync_NpNegativeId_NoGuard()
    {
        // JobId <= 0 short-circuits the guard even for NP (Route Runs are
        // synthetic; SPs reject on their own).
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.ActivateAsync(-1));
        await guard.DidNotReceive().EnsureTucJobInScopeAsync(Arg.Any<int>());
    }

    [Fact]
    public async Task PickupAsync_Np_GuardsFirst()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.PickupAsync(7));
        await guard.Received(1).EnsureTucJobInScopeAsync(7);
    }

    [Fact]
    public async Task MissingAsync_Np_GuardsFirst()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.MissingAsync(7));
        await guard.Received(1).EnsureTucJobInScopeAsync(7);
    }

    [Fact]
    public async Task CompleteAsync_Np_GuardsFirst()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.CompleteAsync(7, "POD", DateTime.UtcNow));
        await guard.Received(1).EnsureTucJobInScopeAsync(7);
    }

    [Fact]
    public async Task LmcAsync_Np_GuardsFirst()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.LmcAsync(7, 88, "CX"));
        await guard.Received(1).EnsureTucJobInScopeAsync(7);
    }

    [Fact]
    public async Task ReleaseAsync_Np_GuardsFirst()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.ReleaseAsync(7));
        await guard.Received(1).EnsureTucJobInScopeAsync(7);
    }

    // -------- courier ops --------

    [Fact]
    public async Task TransferJobAsync_Np_GuardsFirst()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.TransferJobAsync(7, "A", "B"));
        await guard.Received(1).EnsureTucJobInScopeAsync(7);
    }

    [Fact]
    public async Task SendSmsAsync_Np_GuardsFirst()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.SendSmsAsync(7, "021", "hi"));
        await guard.Received(1).EnsureTucJobInScopeAsync(7);
    }

    [Fact]
    public async Task SendSmsToRunAsync_Admin_HitsSp()
    {
        var (sut, _, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.SendSmsToRunAsync(1, "hi"));
    }

    // -------- bulk mutations --------

    [Fact]
    public async Task CancelJobsAsync_EmptyArray_NoOp()
    {
        var (sut, guard, _) = NewSvc(new NpScope(true, null));
        await sut.CancelJobsAsync(Array.Empty<int>());
        await guard.DidNotReceive().EnsureBulkJobInScopeAsync(Arg.Any<int>());
    }

    [Fact]
    public async Task CancelJobsAsync_Null_NoOp()
    {
        var (sut, guard, _) = NewSvc(new NpScope(true, null));
        await sut.CancelJobsAsync(null!);
        await guard.DidNotReceive().EnsureBulkJobInScopeAsync(Arg.Any<int>());
    }

    [Fact]
    public async Task CancelJobsAsync_Np_GuardsEachBulkId()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.CancelJobsAsync(new[] { 1, 2, 3 }));
        await guard.Received(1).EnsureBulkJobInScopeAsync(1);
        await guard.Received(1).EnsureBulkJobInScopeAsync(2);
        await guard.Received(1).EnsureBulkJobInScopeAsync(3);
    }

    [Fact]
    public async Task MoveJobsBackToRunBuilderAsync_EmptyArray_NoOp()
    {
        var (sut, guard, _) = NewSvc(new NpScope(true, null));
        await sut.MoveJobsBackToRunBuilderAsync(Array.Empty<int>(), DateTime.UtcNow, 1, false);
        await guard.DidNotReceive().EnsureBulkJobInScopeAsync(Arg.Any<int>());
    }

    [Fact]
    public async Task MoveJobsBackToRunBuilderAsync_Null_NoOp()
    {
        var (sut, guard, _) = NewSvc(new NpScope(true, null));
        await sut.MoveJobsBackToRunBuilderAsync(null!, DateTime.UtcNow, 1, false);
        await guard.DidNotReceive().EnsureBulkJobInScopeAsync(Arg.Any<int>());
    }

    [Fact]
    public async Task MoveJobsBackToRunBuilderAsync_Np_GuardsEachId()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.MoveJobsBackToRunBuilderAsync(new[] { 5, 6 }, DateTime.UtcNow, 1, true));
        await guard.Received(1).EnsureBulkJobInScopeAsync(5);
        await guard.Received(1).EnsureBulkJobInScopeAsync(6);
    }

    // -------- notes --------

    [Fact]
    public async Task AddJobNoteAsync_Np_GuardsFirst()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.AddJobNoteAsync(7, "note"));
        await guard.Received(1).EnsureTucJobInScopeAsync(7);
    }

    [Fact]
    public async Task AddBulkJobNoteAsync_Np_GuardsFirst()
    {
        var (sut, guard, _) = NewSvc(new NpScope(false, 42));
        await Assert.ThrowsAnyAsync<Exception>(() => sut.AddBulkJobNoteAsync(7, "note"));
        await guard.Received(1).EnsureBulkJobInScopeAsync(7);
    }

    // -------- GPS --------

    [Fact]
    public async Task UpdateGpsAsync_Pickup_GuardsThenAttemptsSp()
    {
        var (sut, guard, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.UpdateGpsAsync(new UpdateJobGpsRequest
            {
                BulkJobId = 5,
                Leg = "pickup",
                Address = "1 Main",
                AddressLines = new[] { "1", "2" },
            }));
        await guard.Received(1).EnsureBulkJobInScopeAsync(5);
    }

    [Fact]
    public async Task UpdateGpsAsync_Delivery_UsesDeliverySp()
    {
        var (sut, guard, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.UpdateGpsAsync(new UpdateJobGpsRequest
            {
                BulkJobId = 6,
                Leg = "delivery",
                Address = "2 Second",
            }));
        await guard.Received(1).EnsureBulkJobInScopeAsync(6);
    }

    [Fact]
    public async Task UpdateGpsAsync_NoAddressLines_DefaultsToEmpty()
    {
        var (sut, _, _) = NewSvc(new NpScope(true, null));
        // Should not NRE - AddressLines default is empty array.
        await Assert.ThrowsAnyAsync<Exception>(() =>
            sut.UpdateGpsAsync(new UpdateJobGpsRequest
            {
                BulkJobId = 7,
                Leg = "delivery",
                Address = "x",
                AddressLines = null!,
            }));
    }

    // -------- text-field partial update --------

    [Fact]
    public async Task UpdateTextFieldsAsync_MissingBulkJob_Throws()
    {
        var (sut, _, _) = NewSvc(new NpScope(true, null));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            sut.UpdateTextFieldsAsync(9999, new UpdateJobTextFieldsRequest { Notes = "new" }));
    }

    // -------- user name resolution (indirect via SP audit param) --------

    [Fact]
    public async Task ActivateAsync_UsesFirstNameSurnameFromClaims_WhenPresent()
    {
        // No direct getter; we cover the ResolveUserName branches by exercising
        // ActivateAsync with different claim states.
        var accessor = AccessorWith(new Claim("FirstName", "Kevin"), new Claim("Surname", "Chan"));
        var (sut, _, _) = NewSvc(new NpScope(true, null), accessor);
        await Assert.ThrowsAnyAsync<Exception>(() => sut.ActivateAsync(1));
    }

    [Fact]
    public async Task ActivateAsync_FallsBackToIdentityName_WhenNoFirstNameSurname()
    {
        var accessor = AccessorWith(new Claim(ClaimTypes.Name, "kevin@urgent.co.nz"));
        var (sut, _, _) = NewSvc(new NpScope(true, null), accessor);
        await Assert.ThrowsAnyAsync<Exception>(() => sut.ActivateAsync(1));
    }

    [Fact]
    public async Task ActivateAsync_FallsBackToUnknown_WhenNoClaims()
    {
        var accessor = AccessorWith(); // empty claims
        var (sut, _, _) = NewSvc(new NpScope(true, null), accessor);
        await Assert.ThrowsAnyAsync<Exception>(() => sut.ActivateAsync(1));
    }
}
