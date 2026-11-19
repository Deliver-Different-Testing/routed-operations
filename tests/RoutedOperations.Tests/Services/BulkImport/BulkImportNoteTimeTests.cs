using System.Globalization;
using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Services.BulkImport;

// UC #881 F3. Anisah's delete note read "on 2026-11-09 22:34:31" under a header
// of "Nov 10, 2026 11:34 AM". Bulk Import notes now read like that header
// (DespatchWeb notesApi.ts, dayjs 'MMM D, YYYY h:mm A'), so the two can be
// compared at a glance. The tenant-clock tests prove the time is tenant-local.
public class BulkImportNoteTimeTests
{
    [Theory]
    [InlineData(2026, 11, 10, 11, 34, 31, "Nov 10, 2026 11:34 AM")]
    [InlineData(2026, 11, 9, 22, 34, 0, "Nov 9, 2026 10:34 PM")]
    [InlineData(2026, 1, 5, 0, 5, 0, "Jan 5, 2026 12:05 AM")]
    [InlineData(2026, 12, 25, 12, 0, 0, "Dec 25, 2026 12:00 PM")]
    public void Formats_like_the_notes_panel_header(int y, int mo, int d, int h, int mi, int s, string want)
    {
        Assert.Equal(want, BulkImportNoteTime.Format(new DateTime(y, mo, d, h, mi, s)));
    }

    [Fact]
    public void Month_and_am_pm_stay_english_on_a_non_english_host()
    {
        var before = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");
            Assert.Equal("Mar 3, 2026 3:30 PM", BulkImportNoteTime.Format(new DateTime(2026, 3, 3, 15, 30, 0)));
        }
        finally
        {
            CultureInfo.CurrentCulture = before;
        }
    }
}
