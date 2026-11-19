using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Services.BulkImport;

// UC #881. The server's copy of bookDateParse.ts. Staff Import never goes
// through the wizard, so it needs the same rules here: the tenant decides
// the order of an ambiguous slash date (NZ dd/MM, US MM/dd), never the
// server's culture. Before this, Staff Import used DateTime.TryParse, which
// reads 12/11/2026 however the host happens to be configured.
public class BulkImportDateParserTests
{
    [Theory]
    [InlineData("13/11/2026", false, "2026-11-13")]
    [InlineData("12/11/2026", false, "2026-11-12")] // NZ: 12 Nov
    [InlineData("12/11/2026", true, "2026-12-11")]  // US: 11 Dec
    [InlineData("11/13/2026", false, "2026-11-13")] // NZ falls back when dd/MM is impossible
    [InlineData("13/11/2026", true, "2026-11-13")]  // US falls back the same way
    [InlineData("1/2/2026", false, "2026-02-01")]
    [InlineData("1/2/2026", true, "2026-01-02")]
    [InlineData("01-02-26", false, "2026-02-01")]
    [InlineData("12/11/2026 08:30", false, "2026-11-12")]
    [InlineData("2026-11-13", false, "2026-11-13")]
    [InlineData("2026-1-3", true, "2026-01-03")]
    [InlineData("2026-11-13T00:00:00", false, "2026-11-13")]
    [InlineData("2026-11-13T08:30:00.000Z", true, "2026-11-13")]
    [InlineData("2026-11-13 08:30", false, "2026-11-13")]
    [InlineData("29/2/2028", false, "2028-02-29")]
    public void ParseDate_reads_the_tenant_order(string raw, bool isUs, string want)
    {
        Assert.Equal(DateTime.Parse(want, System.Globalization.CultureInfo.InvariantCulture),
            BulkImportDateParser.ParseDate(raw, isUs));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("tomorrow")]
    [InlineData("31/02/2026")]
    [InlineData("2026-02-30")]
    [InlineData("13/13/2026")]
    [InlineData("29/2/2026")]
    [InlineData("1899-12-31T08:30:00")] // Excel time-only cell is not a date
    public void ParseDate_unreadable_is_null(string? raw)
    {
        Assert.Null(BulkImportDateParser.ParseDate(raw, false));
        Assert.Null(BulkImportDateParser.ParseDate(raw, true));
    }

    [Theory]
    [InlineData("08:30", 8, 30)]
    [InlineData("8:30", 8, 30)]
    [InlineData("14:00:59", 14, 0)]
    [InlineData("8:30 am", 8, 30)]
    [InlineData("8:30 PM", 20, 30)]
    [InlineData("12:05 am", 0, 5)]
    [InlineData("12:05 pm", 12, 5)]
    [InlineData("1899-12-31T08:30:00", 8, 30)]
    [InlineData("2026-11-13T14:00:00", 14, 0)]
    [InlineData("2026-11-13 14:00", 14, 0)]
    public void ParseTime_reads_24h_12h_and_excel_cells(string raw, int h, int m)
    {
        Assert.Equal(new TimeSpan(h, m, 0), BulkImportDateParser.ParseTime(raw));
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("noon")]
    [InlineData("24:00")]
    [InlineData("8:60")]
    [InlineData("13:00 pm")]
    [InlineData("2026-11-13")]
    public void ParseTime_unreadable_is_null(string? raw)
    {
        Assert.Null(BulkImportDateParser.ParseTime(raw));
    }
}
