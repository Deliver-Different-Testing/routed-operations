using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Territory;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// Review r3-4: the zone group lock SQL runs only on SQL Server, so the
/// Sqlite suite never executes it and a typo or a renamed column would first
/// show on staging. These run the real ZoneGroupLocks code against a real
/// SQL Server, inside a transaction that is always rolled back.
///
/// Opt-in and skipped by default (CI has no SQL Server). Point them at a
/// LOCAL database only, never a tenant:
///   RO_SQLSERVER_TEST_CONN    NZ shape, for example Despatch_Urgent_Staging
///   RO_SQLSERVER_TEST_CONN_US US shape, for example DFRNT_SEED_CR
/// e.g. Server=localhost\MSSQL;Database=Despatch_Urgent_Staging;Trusted_Connection=True;TrustServerCertificate=True
/// </summary>
public class ZoneGroupLocksSqlServerTests
{
    private static string Conn(string name)
    {
        var conn = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(conn))
            Assert.Skip($"{name} is not set; this test needs a local SQL Server.");
        return conn!;
    }

    private static DynamicDespatchDbContext SqlServerContext(string conn) =>
        new(new DbContextOptionsBuilder<DespatchContext>().UseSqlServer(conn).Options);

    private static Task<int> ScalarAsync(DynamicDespatchDbContext db, string sql, params object[] args) =>
        db.Database.SqlQueryRaw<int>(sql, args).ToListAsync().ContinueWith(t => t.Result.Single());

    /// <summary>KEY locks this session holds on the table's clustered primary key.</summary>
    private static Task<int> PkKeyLocksAsync(DynamicDespatchDbContext db, string table, string modes) =>
        ScalarAsync(db,
            "SELECT COUNT(*) AS [Value] FROM sys.dm_tran_locks l "
            + "JOIN sys.partitions p ON p.hobt_id = l.resource_associated_entity_id "
            + "JOIN sys.indexes i ON i.object_id = p.object_id AND i.index_id = p.index_id "
            + $"WHERE l.request_session_id = @@SPID AND l.resource_type = 'KEY' AND p.object_id = OBJECT_ID('{table}') "
            + $"AND i.is_primary_key = 1 AND l.request_mode IN ({modes})");

    [Fact]
    public async Task Nz_the_apply_lock_holds_every_member_by_primary_key_so_a_zone_change_by_id_waits()
    {
        var conn = Conn("RO_SQLSERVER_TEST_CONN");
        await using var db = SqlServerContext(conn);
        var groups = await db.Database.SqlQueryRaw<int>(
            "SELECT TOP 1 PostcodeGroupId AS [Value] FROM dbo.BulkZonePostcode WHERE PostcodeGroupId IS NOT NULL "
            + "GROUP BY PostcodeGroupId ORDER BY COUNT(*) DESC").ToListAsync();
        if (groups.Count == 0) Assert.Skip("No NZ postcode group has members in this database.");
        var groupId = groups[0];

        await using var tx = await db.Database.BeginTransactionAsync();
        try
        {
            var ids = await ZoneGroupLocks.LockGroupForImportAsync(db.Database, groupId, us: false);

            var members = await ScalarAsync(db, "SELECT COUNT(*) AS [Value] FROM dbo.BulkZonePostcode WHERE PostcodeGroupId = {0}", groupId);
            Assert.Equal(members, ids.Count);
            Assert.True(await PkKeyLocksAsync(db, "dbo.BulkZonePostcode", "'U','RangeS-U'") >= ids.Count,
                "every member's primary key must be locked");
            Assert.Equal(1, await PkKeyLocksAsync(db, "dbo.BulkZonePostcodeGroup", "'U','RangeS-U'"));

            // The r3-1 writer: a zone change by Id from outside Routed
            // Operations, which never touches the group index.
            await using var other = new SqlConnection(conn);
            await other.OpenAsync(TestContext.Current.CancellationToken);
            await using var cmd = other.CreateCommand();
            cmd.CommandText = "SET LOCK_TIMEOUT 2000; BEGIN TRAN; "
                + "BEGIN TRY UPDATE dbo.BulkZonePostcode SET Zone = Zone WHERE Id = @id; ROLLBACK; END TRY "
                + "BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH";
            cmd.Parameters.AddWithValue("@id", ids[0]);
            var ex = await Assert.ThrowsAsync<SqlException>(() => cmd.ExecuteNonQueryAsync(TestContext.Current.CancellationToken));
            Assert.Equal(1222, ex.Number);
        }
        finally
        {
            await tx.RollbackAsync(TestContext.Current.CancellationToken);
        }
    }

    [Fact]
    public async Task Us_the_apply_lock_sql_runs_and_returns_the_groups_zips()
    {
        // Local US has no grouped ZIPs, so the test makes a group inside its
        // own transaction. Those rows are then already X-locked by the setup,
        // so this proves the SQL runs and finds the right rows, not the lock
        // shape; FIX3-REPORT has the two-session proof for that.
        var conn = Conn("RO_SQLSERVER_TEST_CONN_US");
        await using var db = SqlServerContext(conn);
        await using var tx = await db.Database.BeginTransactionAsync();
        try
        {
            var groupId = await ScalarAsync(db,
                "INSERT INTO dbo.BulkZonePostcodeGroup (Name) OUTPUT INSERTED.Id AS [Value] VALUES ('RO lock test, rolled back')");
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE TOP (150) dbo.ZoneZip SET ZoneZipGroupId = {0} WHERE ZoneZipGroupId IS NULL", groupId);
            var expected = await db.Database.SqlQueryRaw<int>(
                "SELECT ZoneZipId AS [Value] FROM dbo.ZoneZip WHERE ZoneZipGroupId = {0}", groupId).ToListAsync();
            if (expected.Count == 0) Assert.Skip("No ZoneZip rows to group in this database.");

            var ids = await ZoneGroupLocks.LockGroupForImportAsync(db.Database, groupId, us: true);

            Assert.Equal(expected.OrderBy(i => i), ids.OrderBy(i => i));
            Assert.True(await PkKeyLocksAsync(db, "dbo.ZoneZip", "'U','RangeS-U','X'") >= ids.Count);
        }
        finally
        {
            await tx.RollbackAsync(TestContext.Current.CancellationToken);
        }
    }
}
