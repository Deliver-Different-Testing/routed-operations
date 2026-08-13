// Shared InMemory-EF plumbing for RouteViewer* service tests. Mirrors the
// RecurringLinehaulTestHarness pattern: one unique InMemory store per test,
// the substituted IDbContextFactory hands out fresh contexts over the same
// backing store so seed + service reads see the same rows. EnableNullChecks
// off matches SQL Server's tolerance for defaulted-non-null cols.
//
// Most RouteViewer services invoke stored procedures via SqlQueryRaw /
// ExecuteSqlRawAsync which InMemory does NOT execute. Tests here cover the
// code paths that resolve BEFORE the SP call: scope-guard early returns,
// input short-circuits, empty-list guards, EF-only fallbacks, and pure
// helper methods.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.RouteViewer;

internal static class RouteViewerTestHarness
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
}
