using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Tests.Services;

namespace RoutedOperations.Tests.Domain;

/// <summary>
/// Model-shape regression guard for the Schedules module.
///
/// Backstory: 2026-08-25 the /api/schedules endpoint crashed on real SQL
/// Server with "Invalid column name 'TblBulkRunScheduleBulkRunScheduleId'".
/// EF Core had minted a shadow FK column on BulkZoneSchedule because
/// DespatchContext held TWO overlapping configs for the
/// TblBulkRunSchedule <-> BulkZoneSchedule relationship - one with a
/// named reciprocal collection (added in the Schedules partial), one
/// with an anonymous WithMany() (pre-existing). EF treated them as two
/// separate relationships and invented a shadow FK for the anonymous
/// one.
///
/// Every service test in ScheduleServiceTests passed anyway because
/// they run on EF InMemory, which stores rows in a dictionary and does
/// not care about physical column names.
///
/// These tests walk the built model and fail if any Schedules-touched
/// entity carries a shadow FK. That would have caught the bug in-
/// harness rather than in staging.
/// </summary>
public class ScheduleModelShapeTests
{
    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    [Theory]
    [InlineData(typeof(TblBulkRunSchedule))]
    [InlineData(typeof(BulkZoneSchedule))]
    [InlineData(typeof(TblBulkScheduleLinehaul))]
    [InlineData(typeof(TblDropOffLocation))]
    [InlineData(typeof(BulkRunPolygon))]
    public void EntityHasNoShadowForeignKeyProperties(Type entityType)
    {
        using var ctx = new DynamicDespatchDbContext(NewOptions());
        var et = ctx.Model.FindEntityType(entityType)
            ?? throw new Xunit.Sdk.XunitException($"Entity {entityType.Name} not found in model.");

        // A shadow property is one EF materialises in the model without a
        // corresponding CLR property on the entity. On a real-table entity
        // that means EF will SELECT a column that does not exist in the
        // DB. Legitimate on M:N join tables (their composite PK is shadow
        // by design) but we assert here against fully-mapped root entities
        // only, so there should be zero shadow properties.
        var shadowProps = et.GetProperties()
            .Where(p => p.IsShadowProperty())
            .Select(p => p.Name)
            .ToList();

        Assert.True(
            shadowProps.Count == 0,
            $"Entity {entityType.Name} has unexpected shadow properties: [{string.Join(", ", shadowProps)}]. " +
            "This means EF Core will attempt to SELECT a column that does not exist in the DB. " +
            "Usually caused by two overlapping relationship configs in DespatchContext.OnModelCreating - " +
            "reciprocate the collection with .WithMany(x => x.Collection) on both sides.");
    }

    [Fact]
    public void ScheduleRelationships_UseNamedForeignKeys_NotShadow()
    {
        // Explicit assertion of the FK columns that back the two Schedules
        // relationships. If the wiring drifts (e.g. someone deletes the
        // Fluent config and EF falls back to convention), the FK name
        // check will pick a shadow-derived name and this test fails.
        using var ctx = new DynamicDespatchDbContext(NewOptions());

        var zoneFk = ctx.Model.FindEntityType(typeof(BulkZoneSchedule))!
            .GetForeignKeys()
            .Single(fk => fk.PrincipalEntityType.ClrType == typeof(TblBulkRunSchedule));
        Assert.Equal(new[] { "ScheduleId" }, zoneFk.Properties.Select(p => p.Name).ToArray());
        Assert.False(zoneFk.Properties[0].IsShadowProperty(),
            "BulkZoneSchedule.ScheduleId must be the physical FK, not a shadow property.");

        var linehaulFk = ctx.Model.FindEntityType(typeof(TblBulkScheduleLinehaul))!
            .GetForeignKeys()
            .Single(fk => fk.PrincipalEntityType.ClrType == typeof(TblBulkRunSchedule));
        Assert.Equal(new[] { "BulkRunScheduleId" }, linehaulFk.Properties.Select(p => p.Name).ToArray());
        Assert.False(linehaulFk.Properties[0].IsShadowProperty(),
            "TblBulkScheduleLinehaul.BulkRunScheduleId must be the physical FK, not a shadow property.");
    }

    [Fact]
    public void SchedulesModule_QueryableViaSqlite_WithoutInvalidColumnCrash()
    {
        // Belt-and-braces: run the actual query the Schedules service issues
        // against a Sqlite in-memory DB. Sqlite enforces column existence
        // when EnsureCreated builds the tables from the model, so any
        // shadow FK the model carries surfaces here as a "no such column"
        // error at query time (same class of failure the real SQL Server
        // shows as "invalid column name").
        var (opts, connection) = CockpitTestHarness.NewSqliteOptions();
        try
        {
            using var ctx = new DynamicDespatchDbContext(opts);
            // Issue a query with the same Include-graph as
            // ScheduleService.GetAsync. Empty DB returns empty list;
            // the point is that the SELECT compiles + runs cleanly.
            var _ = ctx.TblBulkRunSchedules
                .Include(s => s.BulkZoneSchedules)
                .Include(s => s.TblBulkScheduleLinehauls)
                .ToList();
        }
        finally
        {
            connection.Dispose();
        }
    }
}
