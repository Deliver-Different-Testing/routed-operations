using System.Globalization;

namespace RoutedOperations.Core.Application.Services.BulkImport;

/// <summary>
/// UC #881 F3. The timestamp Bulk Import writes into a job's notes, in the
/// format the DespatchWeb notes panel shows its own header in (notesApi.ts,
/// dayjs 'MMM D, YYYY h:mm A', e.g. "Nov 10, 2026 11:34 AM"). Invariant
/// culture so the month name is English on any host. Pass tenant-local time.
/// </summary>
public static class BulkImportNoteTime
{
    public static string Format(DateTime tenantLocal) =>
        tenantLocal.ToString("MMM d, yyyy h:mm tt", CultureInfo.InvariantCulture);
}
