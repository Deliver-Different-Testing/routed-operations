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
        // A uniquely-named shared-cache in-memory database rather than
        // `Filename=:memory:` pinned to one DbConnection.
        //
        // `:memory:` gives each CONNECTION its own private database, so the
        // harness had to hand that single connection to EF via
        // UseSqlite(connection) and every context then shared it. Services
        // that fan out with Task.WhenAll - ScheduleService.ListSummaryAsync
        // and GetAsync both do - then had several contexts initialising and
        // querying one connection at the same moment, and EF registers its
        // aggregate functions (SqliteConnection.CreateAggregate) as part of
        // initialising a connection. SQLite refuses that while another
        // statement is active, so the run failed with
        // "SQLite Error 5: database is locked" depending purely on thread
        // timing: measured 3 failures in 6 runs of ScheduleServiceTests on
        // 2026-10-29, always
        // ListSummary_reports_IsDefault_from_the_header_not_from_the_client_count.
        //
        // Naming the database and giving EF the CONNECTION STRING lets it
        // open and close a connection per context, the way it does against
        // SQL Server, so concurrent contexts no longer contend. The name is
        // unique per call so parallel test classes stay isolated.
        var name = $"routedops-tests-{Guid.NewGuid():N}";
        // Foreign-key enforcement OFF: the auto-scaffolded model has FKs to
        // reference tables (tucClient, tucCourier, tucAgent, tblBulkRegion,
        // etc.) that the SUTs under test don't need populated. Turning it off
        // matches InMemory semantics and lets tests focus on business logic.
        // It has to be in the connection string now rather than a PRAGMA on
        // one connection: Microsoft.Data.Sqlite issues PRAGMA foreign_keys=ON
        // on every connection it opens unless told otherwise, and EF is
        // opening its own.
        var connectionString =
            $"Data Source={name};Mode=Memory;Cache=Shared;Foreign Keys=False";
        // A shared-cache in-memory database exists only while at least one
        // connection to it is open. This keeper holds it up for the life of
        // the test; callers already dispose what this method returns.
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        var options = new DbContextOptionsBuilder<DespatchContext>()
            .UseSqlite(connectionString)
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
