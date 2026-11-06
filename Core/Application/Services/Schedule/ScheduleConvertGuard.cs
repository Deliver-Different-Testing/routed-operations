namespace RoutedOperations.Core.Application.Services.Schedule;

/// <summary>
/// Decides whether a schedule must stay in the old one-row-per-day shape even
/// though dbo.uspScheduleConvert would accept it (Steve, 5 Nov 2026). Only until
/// the compatibility view and the booking cutoff check read the ClientId = 0
/// exception rows: a conversion today would change the cutoff bookings see.
///
/// The two rules are HOLD_EXCEPTIONS and HOLD_HOURS_ONLY from
/// DBMigrationV2/DatabaseScripts/AdhocScripts/2026-11-05_ScheduleCollapse_StepF_BatchConvert.sql,
/// so the batch and a save hold the same schedules. HOLD_HOURS_DRIFT is
/// deliberately not here: Steve did not name it.
///
/// This restates the script's derivation rather than asking the procedure,
/// which does report CutoffVariesByDay on a dry run but says nothing about
/// hours-only. If the script's rules change, change this with them.
/// </summary>
public static class ScheduleConvertGuard
{
    public const string CutoffsDifferReason = "Not collapsed: cutoffs differ by day";
    public const string HoursOnlyReason = "Not collapsed: cutoff is set in hours only";

    /// <summary>One day row's cutoff, as the guard should judge it.</summary>
    public readonly record struct Day(int DayOfWeek, byte? CutoffDay, TimeSpan? CutoffTime, int? CutoffHours);

    /// <summary>
    /// The reason to leave the schedule unconverted, or null to let the
    /// procedure decide. Exceptions win over hours-only, the same order as the
    /// script's Disposition CASE.
    /// </summary>
    public static string RefusalReason(IReadOnlyCollection<Day> days)
    {
        // The comparison is on the relative rule, not the stored CutoffDay. A
        // Monday run cut off on Monday and a Tuesday run cut off on Tuesday are
        // the SAME cutoff (0 days before), and a Monday and a Tuesday run both
        // cut off on Monday are different ones.
        //
        // The unit is one choice for the whole schedule: working days if they
        // reach every row, else calendar days. Script: base, u and d CTEs.
        var unit = days.All(d => d.CutoffDay == null || DaysBefore(d, 'W') != null) ? 'W'
            : days.All(d => d.CutoffDay == null || DaysBefore(d, 'C') != null) ? 'C'
            : (char?)null;

        // Script: IsExc and ExcDays. Differing from the majority needs at least
        // two distinct pairs, so counting pairs gives the same yes or no.
        var pairs = days
            .Select(d => (DaysBefore: unit == null ? null : DaysBefore(d, unit.Value), d.CutoffTime))
            .Distinct()
            .Count();
        if (pairs > 1) return CutoffsDifferReason;

        // Script: HoursOnly.
        if (days.Any(d => d.CutoffDay == null && (d.CutoffHours ?? 0) != 0))
            return HoursOnlyReason;

        return null;
    }

    /// <summary>The smallest N that lands on the row's CutoffDay, or null.</summary>
    private static int? DaysBefore(Day d, char unit)
    {
        if (d.CutoffDay == null) return null;
        var maxN = unit == 'W' ? 5 : 6;
        for (var n = 0; n <= maxN; n++)
            if (CutoffDayFor(d.DayOfWeek, n, unit) == d.CutoffDay) return n;
        return null;
    }

    /// <summary>dbo.fnCutoffDayFor.</summary>
    private static int? CutoffDayFor(int dayOfWeek, int daysBefore, char unit)
    {
        if (dayOfWeek is < 1 or > 7) return null;
        if (daysBefore == 0) return dayOfWeek;

        if (unit == 'C')
            return ((dayOfWeek - 1 - daysBefore) % 7 + 7) % 7 + 1;

        var position = dayOfWeek <= 5 ? dayOfWeek : 6;
        return ((position - daysBefore - 1) % 5 + 5) % 5 + 1;
    }
}
