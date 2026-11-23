using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.BulkPolygon;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.BulkPolygon;

/// <summary>
/// Perimeter spec 4.5, Q1 for "Add to zone": BulkPolygonService.AddToZoneAsync
/// runs a geography overlap query (STIntersects) before the write, which
/// InMemory and Sqlite cannot run, so this drives the real method against a
/// real SQL Server inside a transaction that is always rolled back. The only
/// writes are the ones AddToZoneAsync itself makes.
///
/// Opt-in and skipped by default (CI has no SQL Server). Point it at a LOCAL
/// database that has tblBulkRunPolygonApp (migration 20261123160000), never a
/// tenant:
///   RO_SQLSERVER_TEST_CONN  e.g. Server=localhost\MSSQL;Database=Despatch_Urgent_Staging;Trusted_Connection=True;TrustServerCertificate=True
/// </summary>
public class PolygonAppAutoTagSqlServerTests
{
    private static string Conn()
    {
        var conn = Environment.GetEnvironmentVariable("RO_SQLSERVER_TEST_CONN");
        if (string.IsNullOrWhiteSpace(conn))
            Assert.Skip("RO_SQLSERVER_TEST_CONN is not set; this test needs a local SQL Server.");
        return conn!;
    }

    private static Task<List<int>> IntsAsync(DynamicDespatchDbContext db, string sql, params object[] args) =>
        db.Database.SqlQueryRaw<int>(sql, args).ToListAsync();

    [Fact]
    public async Task AddToZone_tags_an_untagged_polygon_Schedules_once_in_the_same_save()
    {
        var conn = Conn();
        await using var db = new DynamicDespatchDbContext(
            new DbContextOptionsBuilder<DespatchContext>().UseSqlServer(conn).Options);

        var polygons = await IntsAsync(db,
            "SELECT TOP 1 p.PolygonId AS [Value] FROM dbo.tblBulkRunPolygon p WHERE p.Active = 1 "
            + "AND NOT EXISTS (SELECT 1 FROM dbo.tblBulkRunPolygonApp a WHERE a.PolygonId = p.PolygonId AND a.AppCode = 'SCHEDULES') "
            + "ORDER BY p.PolygonId");
        if (polygons.Count == 0) Assert.Skip("Every active polygon already has SCHEDULES in this database.");
        // A group with no shapes at all, so the overlap rule cannot refuse.
        var groups = await IntsAsync(db,
            "SELECT TOP 1 g.Id AS [Value] FROM dbo.BulkZonePostcodeGroup g "
            + "WHERE NOT EXISTS (SELECT 1 FROM dbo.BulkZonePolygon z WHERE z.PostcodeGroupId = g.Id) ORDER BY g.Id");
        if (groups.Count == 0) Assert.Skip("No zone group without shapes in this database.");
        var (polygonId, groupId) = (polygons[0], groups[0]);

        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(db);
        var svc = new BulkPolygonService(factory, Substitute.For<IHttpContextAccessor>());

        await using var tx = await db.Database.BeginTransactionAsync(TestContext.Current.CancellationToken);
        try
        {
            var first = await svc.AddToZoneAsync(polygonId, groupId, 1, "k4-test");
            // Moving it to another zone of the same group is a second binding
            // save; the tag is already there and must not be inserted again.
            var moved = await svc.AddToZoneAsync(polygonId, groupId, 2, "k4-test");

            Assert.Equal(1, first.Zone);
            Assert.Equal(2, moved.Zone);
            var tags = await IntsAsync(db,
                "SELECT COUNT(*) AS [Value] FROM dbo.tblBulkRunPolygonApp WHERE PolygonId = {0} AND AppCode = 'SCHEDULES'",
                polygonId);
            Assert.Equal(1, tags.Single());
        }
        finally
        {
            await tx.RollbackAsync(TestContext.Current.CancellationToken);
        }
    }
}
