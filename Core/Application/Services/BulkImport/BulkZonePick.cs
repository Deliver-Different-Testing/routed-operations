using System.Globalization;
using RoutedOperations.Core.Domain.Models;

// NZ zone pricing picks for bulk import, kept pure so the tests run the exact
// code the rating service runs. The rows come from dbo.UTL_fncBulkZone_ResolveAt
// (rating rows only), the resolver booking uses; these helpers apply the same
// filters WS_stpJob_Scheduler_Rates applies to its @ToZones rows.
namespace RoutedOperations.Core.Application.Services.BulkImport;

public static class BulkZonePick
{
    /// <summary>An active zone on the schedule being priced (BulkZoneSchedule.Active,
    /// with the depot and postcode group it applies to).</summary>
    public readonly record struct ActiveZone(int Zone, int? DepotId, int? PostcodeGroupId);

    /// <summary>
    /// The resolver row a job prices on: the row in the schedule's postcode group
    /// whose DepotId is the schedule's Region, like booking. With no schedule id every
    /// row qualifies. A zone active on the schedule wins over one that is not, so a
    /// postcode with two zones on the same group and depot prices on the active one;
    /// then lowest zone first (a null zone last), so the pick is always the same.
    /// </summary>
    public static ResolvedBulkZone? PricingRow(IEnumerable<ResolvedBulkZone> rows, int? scheduleId,
        int? schedulePostcodeGroupId, int? scheduleRegion, IReadOnlyCollection<ActiveZone> activeZones) =>
        rows
            .Where(r => scheduleId == null
                || (r.PostcodeGroupId == schedulePostcodeGroupId && r.DepotId == scheduleRegion))
            .OrderBy(r => !IsActive(r, activeZones))
            .ThenBy(r => r.Zone == null)
            .ThenBy(r => r.Zone)
            .FirstOrDefault();

    /// <summary>True when one of the job's resolver rows is an active zone on the
    /// schedule for the same depot and postcode group.</summary>
    public static bool IsInActiveZone(IEnumerable<ResolvedBulkZone> rows, IReadOnlyCollection<ActiveZone> activeZones) =>
        rows.Any(r => IsActive(r, activeZones));

    private static bool IsActive(ResolvedBulkZone r, IReadOnlyCollection<ActiveZone> activeZones) =>
        activeZones.Any(a => a.Zone == r.Zone && a.DepotId == r.DepotId && a.PostcodeGroupId == r.PostcodeGroupId);

    /// <summary>A delivery latitude/longitude cell as the resolver's decimal(18,9),
    /// or null when blank, unreadable or beyond +/- limit (90 for latitude, 180 for
    /// longitude). Rounds half away from zero like SQL Server converting to
    /// decimal(18,9). Null makes the resolver use the postcode only.</summary>
    public static decimal? ParseCoordinate(string? value, decimal limit)
    {
        if (string.IsNullOrWhiteSpace(value) ||
            !decimal.TryParse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ||
            Math.Abs(d) > limit)
            return null;
        return Math.Round(d, 9, MidpointRounding.AwayFromZero);
    }
}
