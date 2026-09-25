using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.Run;
using RoutedOperations.Core.Application.Services.Run;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.Run;

/// <summary>
/// RunCommitService opens a real SqlConnection inline via
/// `new SqlConnection(connectionString)`. The SP call itself needs SQL
/// Server, but everything up to it is covered here:
/// - tenant resolution guards
/// - connection resolution guards
/// - per-job dispatch loop's Failure branch (bad connection string trips
///   the try/catch for every job, so the returned list is all "Failed").
/// </summary>
public class RunCommitServiceTests
{
    private static RunCommitService NewSut(string? tenantId, string? conn)
    {
        var mgr = Substitute.For<IConnectionStringManager>();
        mgr.GetConnectionStringAsync(Arg.Any<string>()).Returns(conn);
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        if (tenantId is not null)
            ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("CurrentTenantID", tenantId),
            }));
        accessor.HttpContext.Returns(ctx);
        return new RunCommitService(mgr, accessor);
    }

    [Fact]
    public async Task DispatchAsync_NoTenantClaimThrows()
    {
        var sut = NewSut(tenantId: null, conn: "any");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.DispatchAsync(new List<InsertOrUpdateRunRequest>()));
    }

    [Fact]
    public async Task DispatchAsync_EmptyTenantClaimThrows()
    {
        var sut = NewSut(tenantId: string.Empty, conn: "any");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.DispatchAsync(new List<InsertOrUpdateRunRequest>()));
    }

    [Fact]
    public async Task DispatchAsync_NullConnectionThrows()
    {
        var sut = NewSut(tenantId: "1", conn: null);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.DispatchAsync(new List<InsertOrUpdateRunRequest>()));
    }

    [Fact]
    public async Task DispatchJobsAsync_NoTenantClaimThrows()
    {
        var sut = NewSut(tenantId: null, conn: "any");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.DispatchJobsAsync(new DispatchJobsRequest()));
    }

    [Fact]
    public async Task DispatchJobsAsync_EmptyTenantClaimThrows()
    {
        var sut = NewSut(tenantId: string.Empty, conn: "any");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.DispatchJobsAsync(new DispatchJobsRequest()));
    }

    [Fact]
    public async Task DispatchJobsAsync_NullConnectionThrows()
    {
        var sut = NewSut(tenantId: "1", conn: null);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.DispatchJobsAsync(new DispatchJobsRequest()));
    }

    [Fact]
    public async Task DispatchAsync_ResolvesTenantConnectionCacheKey()
    {
        var mgr = Substitute.For<IConnectionStringManager>();
        mgr.GetConnectionStringAsync(Arg.Any<string>()).Returns((string?)null);
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("CurrentTenantID", "77"),
            }))
        };
        accessor.HttpContext.Returns(ctx);
        var sut = new RunCommitService(mgr, accessor);

        try { await sut.DispatchAsync(new List<InsertOrUpdateRunRequest>()); }
        catch (InvalidOperationException) { /* expected */ }

        await mgr.Received(1).GetConnectionStringAsync("77-RoutedOperations-Connection");
    }

    [Fact]
    public async Task DispatchJobsAsync_ResolvesTenantConnectionCacheKey()
    {
        var mgr = Substitute.For<IConnectionStringManager>();
        mgr.GetConnectionStringAsync(Arg.Any<string>()).Returns((string?)null);
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("CurrentTenantID", "88"),
            }))
        };
        accessor.HttpContext.Returns(ctx);
        var sut = new RunCommitService(mgr, accessor);

        try { await sut.DispatchJobsAsync(new DispatchJobsRequest()); }
        catch (InvalidOperationException) { /* expected */ }

        await mgr.Received(1).GetConnectionStringAsync("88-RoutedOperations-Connection");
    }
}
