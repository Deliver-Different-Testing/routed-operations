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
