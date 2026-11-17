// UC #881. One on-demand row's booking time. The row's own Book Date and Book
// Time win; the defaults-step value (the request's BookDate) only fills the half
// the row left blank. A row that brings its own value gets the same window the
// validator gives the batch: after tenant now, before tenant today + 30 days.
// Pure, with tenant now passed in, so it is tested without a clock.
namespace RoutedOperations.Core.Application.Services.BulkImport;

public static class RowBookDate
{
    public const string DateNotRecognised = "Book date not recognised.";
    public const string TimeNotRecognised = "Book time not recognised.";
    public const string InThePast = "Book date is in the past.";
    public const string TooFarAhead = "Book date is more than 30 days ahead.";

    /// <summary>
    /// BookDateTime null with Error null: the row has neither value and books on
    /// the batch default. Error set: the row is refused with that reason.
    /// </summary>
    public sealed record Result(DateTime? BookDateTime, string? Error);

    public static Result Resolve(string? rowDate, string? rowTime, DateTime batchDefault, bool isUsTenant, DateTime tenantNow)
    {
        bool hasDate = !string.IsNullOrWhiteSpace(rowDate);
        bool hasTime = !string.IsNullOrWhiteSpace(rowTime);
        if (!hasDate && !hasTime) return new Result(null, null);

        DateTime date = batchDefault.Date;
        if (hasDate)
        {
            var parsed = BulkImportDateParser.ParseDate(rowDate, isUsTenant);
            if (parsed == null) return new Result(null, DateNotRecognised);
            date = parsed.Value;
        }

        TimeSpan time = new(batchDefault.Hour, batchDefault.Minute, 0);
        if (hasTime)
        {
            var parsed = BulkImportDateParser.ParseTime(rowTime);
            if (parsed == null) return new Result(null, TimeNotRecognised);
            time = parsed.Value;
        }

        var at = date.Add(time);
        if (at < tenantNow) return new Result(null, InThePast);
        if (at >= tenantNow.Date.AddDays(30)) return new Result(null, TooFarAhead);
        return new Result(at, null);
    }
}
