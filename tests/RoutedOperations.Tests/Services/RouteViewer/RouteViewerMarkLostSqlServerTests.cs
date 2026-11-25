using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.RouteViewer;

/// <summary>
/// #320: the real dbo.RVW_stpMarkJobLost against a real SQL Server. Updating
/// tucJob fires the legacy tucJob triggers, which send their own result sets
/// before the proc's SELECT ... AS Updated; RouteViewerMarkLostTests can only
/// fake that, this proves MarkLostAsync reads the right one. Everything runs
/// in ONE transaction that is rolled back: a routed DEL leg is set to Missing
/// (1001) inside it, the real MarkLostAsync runs on the same connection and
/// transaction, then the transaction rolls back and nothing is written.
///
/// Opt-in and skipped by default (CI has no SQL Server), same as
/// RunAssignConcurrencySqlServerTests. Refuses any server that is not the
/// local \MSSQL instance:
///   RO_SQLSERVER_TEST_CONN    e.g. Server=localhost\MSSQL;Database=Despatch_Urgent_Staging;Trusted_Connection=True;TrustServerCertificate=True
/// </summary>
public class RouteViewerMarkLostSqlServerTests
{
    private static string Conn()
    {
        var conn = Environment.GetEnvironmentVariable("RO_SQLSERVER_TEST_CONN");
        if (string.IsNullOrWhiteSpace(conn))
            Assert.Skip("RO_SQLSERVER_TEST_CONN is not set; this test needs a local SQL Server.");
        return conn!;
    }

    private static async Task<object?> ScalarAsync(SqlConnection c, SqlTransaction? tx, string sql, int? jobId = null)
    {
        await using var cmd = new SqlCommand(sql, c, tx);
        if (jobId != null) cmd.Parameters.AddWithValue("@id", jobId.Value);
        return await cmd.ExecuteScalarAsync();
    }

    /// <summary>Hands the service a context on the test's connection that has
    /// joined the test's transaction, so the proc runs inside it.</summary>
    private static IDbContextFactory<DynamicDespatchDbContext> FactoryOn(SqlConnection c, SqlTransaction tx)
    {
        var opts = new DbContextOptionsBuilder<DespatchContext>().UseSqlServer(c).Options;
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ =>
        {
            var ctx = new DynamicDespatchDbContext(opts);
            ctx.Database.UseTransaction(tx);
            return ctx;
        });
        return factory;
    }

    private static RouteViewerJobActionService Service(IDbContextFactory<DynamicDespatchDbContext> factory)
    {
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext());
        return new RouteViewerJobActionService(factory, resolver, Substitute.For<INpScopeGuard>(), accessor,
            NullLogger<RouteViewerJobActionService>.Instance);
    }

    [Fact]
    public async Task Missing_DEL_leg_is_marked_lost_through_the_trigger_result_sets_then_rolled_back()
    {
        await using var c = new SqlConnection(Conn());
        await c.OpenAsync(TestContext.Current.CancellationToken);
        var server = (string)(await ScalarAsync(c, null, "SELECT @@SERVERNAME"))!;
        Assert.True(server.EndsWith(@"\MSSQL", StringComparison.OrdinalIgnoreCase),
            $"Refusing to run: {server} is not the local \\MSSQL instance.");

        // A routed DEL leg with an open root parent, as RVW_stpMissingJob would see it.
        const string pick = @"
            SELECT TOP 1 d.ucjbID FROM dbo.tucJob d
            JOIN dbo.tucJob p ON p.ucjbID = d.RootParentID AND p.ucjbID <> d.ucjbID
            WHERE d.JobRelationshipTypeID = 20 AND d.ucjbNumber LIKE '%DEL%'
              AND d.ucjbVoid = 0 AND ISNULL(d.ucjbJobDone, 0) = 0
              AND p.ucjbVoid = 0 AND ISNULL(p.ucjbJobDone, 0) = 0
            ORDER BY d.ucjbID DESC";
        var picked = await ScalarAsync(c, null, pick);
        if (picked is null or DBNull) Assert.Skip("No open routed DEL leg in this database.");
        var jobId = (int)picked;
        var statusBefore = Convert.ToInt32(await ScalarAsync(c, null, "SELECT ucjbStatus FROM dbo.tucJob WHERE ucjbID = @id", jobId));

        await using (var tx = (SqlTransaction)await c.BeginTransactionAsync(TestContext.Current.CancellationToken))
        {
            await ScalarAsync(c, tx, "UPDATE dbo.tucJob SET ucjbStatus = 1001 WHERE ucjbID = @id", jobId);

            using (var sut = Service(FactoryOn(c, tx)))
            {
                Assert.True(await sut.MarkLostAsync(jobId), $"job {jobId}: proc did not report Updated = 1");
            }

            Assert.Equal(10, Convert.ToInt32(await ScalarAsync(c, tx, "SELECT ucjbStatus FROM dbo.tucJob WHERE ucjbID = @id", jobId)));
            Assert.Equal(1, Convert.ToInt32(await ScalarAsync(c, tx, "SELECT CAST(ucjbJobDone AS int) FROM dbo.tucJob WHERE ucjbID = @id", jobId)));
            Assert.Equal(RouteViewerJobActionService.MarkLostPodName,
                (string)(await ScalarAsync(c, tx, "SELECT ucjbPODName FROM dbo.tucJob WHERE ucjbID = @id", jobId))!);
            Assert.StartsWith("Marked lost via Route Viewer. ",
                (string)(await ScalarAsync(c, tx, "SELECT ucjbNotes FROM dbo.tucJob WHERE ucjbID = @id", jobId))!);
            // The service sends no time, so the proc stamps tenant-local now.
            // A UTC stamp would be hours off on an NZ or US tenant.
            var offBySeconds = Convert.ToInt32(await ScalarAsync(c, tx, @"
                SELECT ABS(DATEDIFF(SECOND, j.ucjbComplTime, t.TenantLocal))
                FROM dbo.tucJob j CROSS APPLY dbo.UTL_tvfServerToTenantLocal(GETDATE()) t
                WHERE j.ucjbID = @id", jobId));
            Assert.InRange(offBySeconds, 0, 60);

            // Second attempt: the job is no longer Missing, the proc changes nothing.
            using (var again = Service(FactoryOn(c, tx)))
            {
                Assert.False(await again.MarkLostAsync(jobId));
            }

            await tx.RollbackAsync(TestContext.Current.CancellationToken);
        }

        Assert.Equal(0, Convert.ToInt32(await ScalarAsync(c, null, "SELECT @@TRANCOUNT")));
        Assert.Equal(statusBefore, Convert.ToInt32(await ScalarAsync(c, null, "SELECT ucjbStatus FROM dbo.tucJob WHERE ucjbID = @id", jobId)));
        TestContext.Current.SendDiagnosticMessage($"{server}/{c.Database}: job {jobId} 1001 -> 10 (Updated 1), retry Updated 0, rolled back to {statusBefore}, @@TRANCOUNT 0");
    }
}
