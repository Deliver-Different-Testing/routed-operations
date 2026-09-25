using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Services.Job;
using RoutedOperations.Infrastructure;

namespace RoutedOperations.Tests.Services.Job;

/// <summary>
/// HdJobSyncService is a Dapper wrapper over a stored procedure. It opens a
/// real SqlConnection via `new SqlConnection(connectionString)` inline, so
/// the SP execution path can only be exercised against a live SQL Server.
/// The tests here cover the tenant-resolution guards that fire BEFORE the
/// connection is opened - namely the two InvalidOperationException guards
/// on missing CurrentTenantID and missing connection string.
/// </summary>
public class HdJobSyncServiceTests
{
    private static (HdJobSyncService Sut, IConnectionStringManager Mgr, IHttpContextAccessor Accessor) NewSut(
        string? tenantId, string? resolvedConnection)
    {
        var mgr = Substitute.For<IConnectionStringManager>();
        mgr.GetConnectionStringAsync(Arg.Any<string>()).Returns(resolvedConnection);
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        if (tenantId is not null)
            ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("CurrentTenantID", tenantId),
            }));
        accessor.HttpContext.Returns(ctx);
        return (new HdJobSyncService(mgr, accessor), mgr, accessor);
    }

    [Fact]
    public async Task SyncAsync_NoTenantClaimThrows()
    {
        var (sut, _, _) = NewSut(tenantId: null, resolvedConnection: "any");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.SyncAsync(new DateTime(2026, 8, 13)));
    }

    [Fact]
    public async Task SyncAsync_EmptyTenantClaimThrows()
    {
        var (sut, _, _) = NewSut(tenantId: string.Empty, resolvedConnection: "any");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.SyncAsync(new DateTime(2026, 8, 13)));
    }

    [Fact]
    public async Task SyncAsync_NullConnectionResolutionThrows()
    {
        var (sut, _, _) = NewSut(tenantId: "1", resolvedConnection: null);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.SyncAsync(new DateTime(2026, 8, 13)));
    }

    [Fact]
    public async Task SyncAsync_EmptyConnectionResolutionThrows()
    {
        var (sut, _, _) = NewSut(tenantId: "1", resolvedConnection: string.Empty);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sut.SyncAsync(new DateTime(2026, 8, 13)));
    }

    [Fact]
    public async Task SyncAsync_UsesTenantIdInCacheKey()
    {
        var (sut, mgr, _) = NewSut(tenantId: "42", resolvedConnection: null);

        try { await sut.SyncAsync(new DateTime(2026, 8, 13)); }
        catch (InvalidOperationException) { /* expected */ }

        await mgr.Received(1).GetConnectionStringAsync("42-RoutedOperations-Connection");
    }

    [Fact]
    public async Task SyncAsync_ReturnsFailedOnMalformedConnectionString()
    {
        // Not-a-connection-string throws ArgumentException from the
        // SqlConnection constructor. That is inside the try/catch so the
        // service returns a ("Failed", <message>) tuple instead of throwing.
        var (sut, _, _) = NewSut(tenantId: "1",
            resolvedConnection: "===this-is-not-a-conn-string===");

        var (result, message) = await sut.SyncAsync(new DateTime(2026, 8, 13));

        Assert.Equal("Failed", result);
        Assert.NotNull(message);
    }
}
