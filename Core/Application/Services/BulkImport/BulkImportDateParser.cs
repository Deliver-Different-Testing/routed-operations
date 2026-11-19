using System.Globalization;
using System.Text.RegularExpressions;

// UC #881. Book Date / Book Time cell parsing for bulk import, server side.
// Same rules as the wizard's bookDateParse.ts so a file reads the same way
// whether it comes through New Import or Staff Import:
//   - ISO yyyy-M-d, with or without a time part ('T' or space).
//   - Slash or dash dates in the tenant's order, NZ d/M/yyyy and US M/d/yyyy.
//     When the tenant's order cannot be a real date, the other order is tried
//     (11/13/2026 on NZ, 13/11/2026 on US).
//   - Two-digit years are 20yy.
//   - Excel stores a time-only cell on 1899-12-30/31; that is never a date.
//   - English month names, which cannot be misread in either tenant order:
//     13 Nov 2026, 13-Nov-2026, 13-Nov-26, 13 November 2026, Nov 13, 2026.
//     A month-first date needs a four-digit year. A trailing time is ignored.
// Explicit ParseExact format lists only. Never the culture-driven TryParse,
// which reads 12/11/2026 however the host machine happens to be set up.
namespace RoutedOperations.Core.Application.Services.BulkImport;

public static class BulkImportDateParser
{
    private static readonly CultureInfo Invariant20yy = BuildCulture();

    private static readonly string[] DayFirst =
        { "d/M/yyyy", "d/M/yy", "d-M-yyyy", "d-M-yy" };

    private static readonly string[] MonthFirst =
        { "M/d/yyyy", "M/d/yy", "M-d-yyyy", "M-d-yy" };

    private static readonly string[] Iso = { "yyyy-M-d" };

    private static readonly Regex DayMonthName = new(
        @"^([0-9]{1,2})(?:\s+|-)([A-Za-z]{3,9})\.?(?:\s+|-)([0-9]{4}|[0-9]{2})(?:\s.*)?$", RegexOptions.CultureInvariant);

    private static readonly Regex MonthNameDay = new(
        @"^([A-Za-z]{3,9})\.?\s+([0-9]{1,2}),?\s+([0-9]{4})(?:\s.*)?$", RegexOptions.CultureInvariant);

    private static readonly string[] MonthNames =
    {
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december",
    };

    private static readonly string[] TimeFormats =
    {
        "H:mm", "H:mm:ss", "H:mm:ss.FFFFFFF",
        "h:mm tt", "h:mm:ss tt", "h:mmtt", "h:mm:sstt",
    };

    /// <summary>The date part of a cell, or null when it cannot be read.</summary>
    public static DateTime? ParseDate(string? raw, bool isUsTenant)
    {
        var s = raw?.Trim();
        if (string.IsNullOrEmpty(s)) return null;

        // Only the date part decides the date; a trailing time is ignored.
        var isoLike = s.Length >= 5 && char.IsDigit(s[0]) && s.IndexOf('-') == 4;
        var cut = isoLike ? s.IndexOfAny(new[] { 'T', ' ' }) : s.IndexOf(' ');
        var datePart = cut > 0 ? s[..cut] : s;

        if (isoLike)
        {
            if (!Exact(datePart, Iso, out var iso)) return null;
            if (iso.Year == 1899) return null; // Excel time-only cell
            return iso;
        }

        var dayFirst = DayMonthName.Match(s);
        if (dayFirst.Success)
            return Named(dayFirst.Groups[3].Value, dayFirst.Groups[2].Value, dayFirst.Groups[1].Value);
        var monthFirst = MonthNameDay.Match(s);
        if (monthFirst.Success)
            return Named(monthFirst.Groups[3].Value, monthFirst.Groups[1].Value, monthFirst.Groups[2].Value);

        var (primary, fallback) = isUsTenant ? (MonthFirst, DayFirst) : (DayFirst, MonthFirst);
        if (Exact(datePart, primary, out var dt)) return dt;
        if (Exact(datePart, fallback, out dt)) return dt;
        return null;
    }

    /// <summary>The time of day in a cell, or null when it cannot be read.</summary>
    public static TimeSpan? ParseTime(string? raw)
    {
        var s = raw?.Trim();
        if (string.IsNullOrEmpty(s)) return null;

        // Time carried on an ISO datetime, including Excel's 1899-12-31T08:30:00.
        if (s.Length >= 10 && char.IsDigit(s[0]) && s.IndexOf('-') == 4)
        {
            var cut = s.IndexOfAny(new[] { 'T', ' ' });
            if (cut < 0) return null;
            s = s[(cut + 1)..].TrimEnd('Z');
            var offset = s.IndexOfAny(new[] { '+', '-' });
            if (offset > 0) s = s[..offset];
        }

        return DateTime.TryParseExact(s, TimeFormats, Invariant20yy, DateTimeStyles.AllowInnerWhite, out var t)
            ? new TimeSpan(t.Hour, t.Minute, 0) // minutes, like the wizard's HH:mm
            : null;
    }

    private static DateTime? Named(string year, string monthName, string day)
    {
        var name = monthName.ToLowerInvariant();
        int month = name == "sept" ? 9
            : Array.FindIndex(MonthNames, m => m == name || (name.Length == 3 && m.StartsWith(name, StringComparison.Ordinal))) + 1;
        int y = int.Parse(year, CultureInfo.InvariantCulture);
        if (y < 100) y += 2000;
        int d = int.Parse(day, CultureInfo.InvariantCulture);
        if (month < 1 || d < 1 || d > DateTime.DaysInMonth(y, month)) return null;
        return new DateTime(y, month, d);
    }

    private static bool Exact(string value, string[] formats, out DateTime result)
    {
        var ok = DateTime.TryParseExact(value, formats, Invariant20yy, DateTimeStyles.None, out result);
        result = result.Date;
        return ok;
    }

    private static CultureInfo BuildCulture()
    {
        // InvariantCulture maps "yy" 50-99 to the 1900s. A booking file never
        // means 1950, so pin it to 20yy like the wizard does.
        var c = (CultureInfo)CultureInfo.InvariantCulture.Clone();
        c.DateTimeFormat.Calendar.TwoDigitYearMax = 2099;
        return CultureInfo.ReadOnly(c);
    }
}
