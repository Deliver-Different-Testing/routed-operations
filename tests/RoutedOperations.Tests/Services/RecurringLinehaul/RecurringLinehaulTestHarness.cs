using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

/// <summary>
/// Shared InMemory-EF plumbing for RecurringLinehaulService + RecurringLinehaulJobsService tests.
/// The services resolve their DbContext lazily through IDbContextFactory (BaseService pattern), so
/// the substituted factory hands out fresh DynamicDespatchDbContext instances over a single uniquely-
/// named InMemory store per test. That way seed writes, service reads, and post-assertion reads all
/// see the same data. Null-checks are disabled to match ServiceTestHarness in Configurator - SQL
/// Server has non-null store defaults that the app relies on, InMemory has none, so EnableNullChecks(false)
/// keeps the two providers behavioural-equivalent for insert paths where the SUT never sets those columns.
/// </summary>
internal static class RecurringLinehaulTestHarness
{
    internal static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

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

    /// <summary>Fresh context for post-mutation assertions. The seed context has entities
    /// cached in its ChangeTracker which shadow updates made through the service's own
    /// DbContext; a brand-new context re-materialises from the InMemory store, so writes
    /// from the SUT are visible.</summary>
    internal static DynamicDespatchDbContext Verify(DbContextOptions<DespatchContext> options) => new(options);
}
