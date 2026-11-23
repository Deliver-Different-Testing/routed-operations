#nullable disable
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;

namespace RoutedOperations.Core.Domain.Despatch;

/// <summary>
/// Which apps list a Polygon Builder polygon (perimeter spec Part A 4.2,
/// migration 20261123160000_PolygonAvailableToApps). One row per
/// (polygon, app). AppCode is one of <see cref="PolygonApps.All"/>; the DB
/// enforces the same list with CK_BulkRunPolygonApp_Code.
///
/// It is a listing filter only: which pickers show the shape. Availability
/// and zone rating still read the bindings (BulkZonePolygon, ZoneNameId).
/// </summary>
[Table("tblBulkRunPolygonApp")]
public partial class BulkRunPolygonApp
{
    public int PolygonId { get; set; }

    [Required]
    [MaxLength(30)]
    [Unicode(false)]
    public string AppCode { get; set; }

    [Column(TypeName = "datetime2")]
    public DateTime CreatedUtc { get; set; }

    public virtual BulkRunPolygon Polygon { get; set; }
}

/// <summary>The five app codes, in the order the UI shows them.</summary>
public static class PolygonApps
{
    public const string Schedules = "SCHEDULES";
    public const string AutoDispatch = "AUTODISPATCH";
    public const string Routes = "ROUTES";
    public const string ZoneRating = "ZONE_RATING";
    /// <summary>Rating perimeter ("City boundary"). Changes distance-rated prices.</summary>
    public const string Perimeter = "PERIMETER";

    public static readonly IReadOnlyList<string> All =
        [Schedules, AutoDispatch, Routes, ZoneRating, Perimeter];

    /// <summary>Trims, upper-cases, de-duplicates and sorts into <see cref="All"/> order.
    /// Throws InvalidOperationException naming the first unknown code.</summary>
    public static List<string> Normalise(IEnumerable<string> codes)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var raw in codes ?? [])
        {
            var code = raw?.Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(code)) continue;
            if (!All.Contains(code))
                throw new InvalidOperationException(
                    $"Unknown polygon app \"{raw}\". Allowed: {string.Join(", ", All)}.");
            set.Add(code);
        }
        return All.Where(set.Contains).ToList();
    }

    /// <summary>Sorts stored codes into display order; unknown codes go last.</summary>
    public static List<string> Order(IEnumerable<string> codes) =>
        codes.Distinct()
            .OrderBy(c => All.Contains(c) ? All.ToList().IndexOf(c) : int.MaxValue)
            .ThenBy(c => c, StringComparer.Ordinal)
            .ToList();
}
