using System.Data.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services;

/// <summary>
/// Shared plumbing for the cockpit + sibling service tests. Two flavours:
///   * InMemory - default for pure-EF services. Fresh unique store per test.
///   * Sqlite   - opt-in for services that hit transactions or raw SQL that
///                InMemory can't emulate (JobService.BulkUpdate + VoidJobService).
/// Both hand out fresh DynamicDespatchDbContext instances via a substituted
/// IDbContextFactory so the SUT sees a fresh change tracker per operation
/// (matches BaseService lazy-context behaviour under real DI).
/// </summary>
internal static class CockpitTestHarness
{
    internal static DbContextOptions<DespatchContext> NewInMemoryOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    internal static (DbContextOptions<DespatchContext> Options, DbConnection Connection) NewSqliteOptions()
    {
        var connection = new SqliteConnection("Filename=:memory:");
        connection.Open();
        // Foreign-key enforcement OFF: the auto-scaffolded model has FKs to
        // reference tables (tucClient, tucCourier, tucAgent, tblBulkRegion,
        // etc.) that the SUTs under test don't need populated. Turning it off
        // matches InMemory semantics and lets tests focus on business logic.
        using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA foreign_keys = OFF;";
            pragma.ExecuteNonQuery();
        }
        var options = new DbContextOptionsBuilder<DespatchContext>()
            .UseSqlite(connection)
            .Options;
        using (var ctx = new DynamicDespatchDbContext(options))
        {
            ctx.Database.EnsureCreated();
            // EnsureCreated builds TABLES from the model, and since
            // 20261009177000 TblBulkRunSchedule is mapped ToView, so the view
            // has to be created here or every read of it fails with "no such
            // table". Created over the physical day table, the same shape the
            // migration creates in production.
            //
            // SELECT * rather than a column list: the point of reading through
            // a view in tests at all is that EF's generated SELECT names only
            // columns that really exist, so the view exposes whatever the day
            // table has and a wrong column name still fails.
            //
            // The real view also synthesises a converted schedule's payload
            // from its detail row. That part is NOT reproduced: it is SQL
            // Server logic under test against a real database, not here. A
            // test that needs it must not use this harness.
            ctx.Database.ExecuteSqlRaw(
                "CREATE VIEW tblBulkRunSchedule AS SELECT * FROM tblBulkRunScheduleDay;");
        }
        return (options, connection);
    }

    internal static DynamicDespatchDbContext Context(DbContextOptions<DespatchContext> options) =>
        new(options);

    internal static IDbContextFactory<DynamicDespatchDbContext> Factory(DbContextOptions<DespatchContext> options)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(options));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(options)));
        return factory;
    }
}
