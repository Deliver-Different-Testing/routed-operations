using System.Text.RegularExpressions;

namespace RoutedOperations.Tests.Services.BulkImport;

// UC #881 F3. A zone 12 hours behind UTC, so the host clock (NZ on Kevin's
// machine, UTC on CI) is never the tenant clock.
internal static class BulkImportTenantClock
{
    internal const string Zone = "Dateline Standard Time";

    internal static DateTime Now => DateTime.UtcNow.AddHours(-12);

    internal static void AssertNear(DateTime? actual)
    {
        Assert.NotNull(actual);
        Assert.InRange(actual!.Value, Now.AddMinutes(-2), Now.AddMinutes(2));
    }

    internal static void AssertNoteNear(string? notes)
    {
        // The notes panel format (DespatchWeb notesApi.ts, dayjs 'MMM D, YYYY h:mm A').
        var match = Regex.Match(notes ?? string.Empty, @" on ([A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M)\.");
        Assert.True(match.Success, $"No timestamp in note: {notes}");
        AssertNear(DateTime.ParseExact(match.Groups[1].Value, "MMM d, yyyy h:mm tt", System.Globalization.CultureInfo.InvariantCulture));
    }
}
