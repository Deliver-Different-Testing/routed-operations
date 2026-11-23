using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.BulkPolygon;

/// <summary>
/// Auto-tag on bind (perimeter spec 4.5, product decision Q1). When a polygon
/// is bound to an app's object (a zone group zone, a ZoneName, a recurring
/// route's coverage) and lacks that app's tblBulkRunPolygonApp row, the row is
/// added in the same save as the binding, so the polygon shows up in that
/// app's pickers from then on.
///
/// Only ever adds. Unbinding leaves the tag alone (Q4: a tag without a binding
/// is allowed, the operator removes it in the Builder).
/// </summary>
public static class PolygonAppTags
{
    /// <summary>
    /// Stages one tblBulkRunPolygonApp row per polygon that does not have
    /// <paramref name="app"/> yet; the caller's SaveChangesAsync writes them
    /// with the binding. Idempotent: ids already tagged in the database, or
    /// already staged on this context, are skipped, so a repeat bind never
    /// trips the (PolygonId, AppCode) primary key. Returns the ids tagged.
    /// </summary>
    public static async Task<List<int>> EnsureAsync(
        DespatchContext context, IEnumerable<int> polygonIds, string app)
    {
        if (!PolygonApps.All.Contains(app))
            throw new ArgumentException($"Unknown polygon app \"{app}\".", nameof(app));
        var ids = polygonIds.Distinct().ToList();
        if (ids.Count == 0) return [];

        var tagged = (await context.BulkRunPolygonApps.AsNoTracking()
                .Where(a => a.AppCode == app && ids.Contains(a.PolygonId))
                .Select(a => a.PolygonId)
                .ToListAsync())
            .ToHashSet();
        foreach (var staged in context.ChangeTracker.Entries<BulkRunPolygonApp>()
                     .Where(e => e.Entity.AppCode == app
                                 && (e.State is EntityState.Added or EntityState.Unchanged or EntityState.Modified)))
            tagged.Add(staged.Entity.PolygonId);

        var missing = ids.Where(id => !tagged.Contains(id)).ToList();
        var now = DateTime.UtcNow;
        context.BulkRunPolygonApps.AddRange(missing.Select(id => new BulkRunPolygonApp
        {
            PolygonId = id, AppCode = app, CreatedUtc = now,
        }));
        return missing;
    }
}
