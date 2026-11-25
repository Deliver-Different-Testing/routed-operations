using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using RoutedOperations.Core.Application.Dtos.BulkPolygon;
using RoutedOperations.Core.Application.Services.BulkPolygon;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.BulkPolygon;

/// <summary>
/// Review C8: BulkPolygonService.CreateAsync writes the polygon row (raw SQL),
/// its points (raw SQL), the postcode overlay rows (raw SQL) and the app tags
/// (EF SaveChanges). If the tag save fails, none of the rest may stay behind,
/// or the polygon exists with no tags and no picker ever lists it.
///
/// InMemory cannot run the geography SQL or transactions, so this drives the
/// real method against a real SQL Server. Everything runs inside an outer
/// transaction that is always rolled back; CreateAsync must then use a
/// savepoint, so a failure inside it undoes only its own writes. Afterwards
/// the test checks @@TRANCOUNT is 0 and the table counts are unchanged.
///
/// Opt-in and skipped by default (CI has no SQL Server). LOCAL databases only:
///   RO_SQLSERVER_TEST_CONN  e.g. Server=localhost\MSSQL;Database=Despatch_Urgent_Staging;Trusted_Connection=True;TrustServerCertificate=True
/// </summary>
public class BulkPolygonCreateAtomicSqlServerTests
{
    private const string CountsSql =
        "SELECT v.[Value] FROM (VALUES "
        + "(1, (SELECT COUNT(*) FROM dbo.tblBulkRunPolygon)), "
        + "(2, (SELECT COUNT(*) FROM dbo.tblBulkRunPolygonPoint)), "
        + "(3, (SELECT COUNT(*) FROM dbo.tblBulkRunPolygonApp)), "
        + "(4, (SELECT COUNT(*) FROM dbo.BulkRunPolygonZip))) v(o, [Value]) ORDER BY v.o";

    private static string Conn()
    {
        var conn = Environment.GetEnvironmentVariable("RO_SQLSERVER_TEST_CONN");
        if (string.IsNullOrWhiteSpace(conn))
            Assert.Skip("RO_SQLSERVER_TEST_CONN is not set; this test needs a local SQL Server.");
        var server = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(conn).DataSource;
        if (!server.StartsWith("localhost", StringComparison.OrdinalIgnoreCase)
            && !server.StartsWith("(local)", StringComparison.OrdinalIgnoreCase)
            && !server.StartsWith(".", StringComparison.Ordinal))
            throw new InvalidOperationException($"Refusing to run against non-local server '{server}'.");
        return conn!;
    }

    /// <summary>Throws on SaveChanges while armed, standing in for a failed tag save.</summary>
    private sealed class FailingSaveInterceptor : SaveChangesInterceptor
    {
        public bool Armed { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            Armed
                ? throw new InvalidOperationException("Simulated tag save failure")
                : base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private static Task<List<int>> IntsAsync(DynamicDespatchDbContext db, string sql, params object[] args) =>
        db.Database.SqlQueryRaw<int>(sql, args).ToListAsync();

    private static CreateBulkPolygonRequest Request(string name) => new(
        name, -36.8505m, 174.7605m,
        [
            new PolygonPointDto(0, 0, -36.850, 174.760),
            new PolygonPointDto(0, 1, -36.850, 174.761),
            new PolygonPointDto(0, 2, -36.851, 174.761),
            new PolygonPointDto(0, 3, -36.851, 174.760),
        ]);

    [Fact]
    public async Task Create_is_all_or_nothing_and_leaves_the_database_unchanged()
    {
        var conn = Conn();
        var ct = TestContext.Current.CancellationToken;
        var interceptor = new FailingSaveInterceptor();
        List<int> before;
        await using (var db = new DynamicDespatchDbContext(
            new DbContextOptionsBuilder<DespatchContext>().UseSqlServer(conn).AddInterceptors(interceptor).Options))
        {
            before = await IntsAsync(db, CountsSql);
            var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
            factory.CreateDbContext().Returns(db);
            var svc = new BulkPolygonService(factory, Substitute.For<IHttpContextAccessor>());
            var name = $"c8-test-{Guid.NewGuid():N}"[..30];

            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try
            {
                var maxId = (await IntsAsync(db,
                    "SELECT ISNULL(MAX(PolygonId), 0) AS [Value] FROM dbo.tblBulkRunPolygon")).Single();

                // 1. The tag save fails: the polygon, its points and its overlay rows go too.
                interceptor.Armed = true;
                await Assert.ThrowsAsync<InvalidOperationException>(() => svc.CreateAsync(Request(name)));
                interceptor.Armed = false;
                db.ChangeTracker.Clear();
                Assert.Equal(0, (await IntsAsync(db,
                    "SELECT COUNT(*) AS [Value] FROM dbo.tblBulkRunPolygon WHERE PolygonId > {0}", maxId)).Single());
                Assert.Equal(0, (await IntsAsync(db,
                    "SELECT COUNT(*) AS [Value] FROM dbo.tblBulkRunPolygonPoint WHERE PolygonId > {0}", maxId)).Single());
                Assert.Equal(0, (await IntsAsync(db,
                    "SELECT COUNT(*) AS [Value] FROM dbo.BulkRunPolygonZip WHERE PolygonId > {0}", maxId)).Single());
                // Only the savepoint was undone; the caller's transaction is still open.
                Assert.Equal(1, (await IntsAsync(db, "SELECT @@TRANCOUNT AS [Value]")).Single());

                // 2. The same create succeeding writes polygon, points and the default tag together.
                var created = await svc.CreateAsync(Request(name));
                Assert.Equal(new[] { "SCHEDULES" }, created.Apps);
                Assert.Equal(4, (await IntsAsync(db,
                    "SELECT COUNT(*) AS [Value] FROM dbo.tblBulkRunPolygonPoint WHERE PolygonId = {0}",
                    created.PolygonId)).Single());
                Assert.Equal(1, (await IntsAsync(db,
                    "SELECT COUNT(*) AS [Value] FROM dbo.tblBulkRunPolygonApp WHERE PolygonId = {0}",
                    created.PolygonId)).Single());
            }
            finally
            {
                await tx.RollbackAsync(ct);
            }
        }

        // Fresh connection: nothing was left open and nothing was kept.
        await using var check = new DynamicDespatchDbContext(
            new DbContextOptionsBuilder<DespatchContext>().UseSqlServer(conn).Options);
        Assert.Equal(0, (await IntsAsync(check, "SELECT @@TRANCOUNT AS [Value]")).Single());
        Assert.Equal(before, await IntsAsync(check, CountsSql));
    }
}
