using RoutedOperations.Core.Application.Services.BulkImport;

namespace RoutedOperations.Tests.Services.BulkImport;

// UC #881. Each on-demand row books for its own Book Date and Book Time. The
// defaults-step value only fills what the row left blank. A row whose own date
// is unreadable, in the past or beyond the 30-day window is refused by itself;
// before this the server ignored the row value and booked the whole file on the
// defaults-step date, so the customer's two different days became one.
public class RowBookDateTests
{
    // Tenant clock: Tue 17 Nov 2026 10:00.
    private static readonly DateTime Now = new(2026, 11, 17, 10, 0, 0);
    private static readonly DateTime Batch = new(2026, 11, 18, 9, 30, 0);

    private static RowBookDate.Result Nz(string? date, string? time) =>
        RowBookDate.Resolve(date, time, Batch, isUsTenant: false, Now);

    [Fact]
    public void A_row_with_its_own_date_and_time_books_for_them()
    {
        Assert.Equal(new DateTime(2026, 11, 20, 8, 30, 0), Nz("20/11/2026", "08:30").BookDateTime);
        Assert.Equal(new DateTime(2026, 11, 19, 14, 0, 0), Nz("19/11/2026", "2:00 pm").BookDateTime);
    }

    [Fact]
    public void A_blank_row_uses_the_defaults_step_value()
    {
        var r = Nz(null, "  ");
        Assert.Null(r.Error);
        Assert.Null(r.BookDateTime); // null = "use the batch default", checked by the batch rules
    }

    [Fact]
    public void Only_the_blank_half_comes_from_the_defaults_step()
    {
        Assert.Equal(new DateTime(2026, 11, 20, 9, 30, 0), Nz("20/11/2026", null).BookDateTime);
        Assert.Equal(new DateTime(2026, 11, 18, 7, 15, 0), Nz("", "07:15").BookDateTime);
    }

    [Fact]
    public void The_tenant_decides_the_order()
    {
        Assert.Equal(new DateTime(2026, 11, 12, 8, 0, 0),
            RowBookDate.Resolve("12/11/2026", "08:00", new DateTime(2026, 11, 12), isUsTenant: false, new DateTime(2026, 11, 1)).BookDateTime);
        Assert.Equal(new DateTime(2026, 12, 11, 8, 0, 0),
            RowBookDate.Resolve("12/11/2026", "08:00", Batch, isUsTenant: true, Now).BookDateTime);
    }

    [Theory]
    [InlineData("31/02/2026", "08:00", "Book date not recognised.")]
    [InlineData("soon", null, "Book date not recognised.")]
    [InlineData("20/11/2026", "noon", "Book time not recognised.")]
    [InlineData("16/11/2026", "08:00", "Book date is in the past.")]   // yesterday
    [InlineData("17/11/2026", "09:59", "Book date is in the past.")]   // earlier today
    [InlineData("17/12/2026", "08:00", "Book date is more than 30 days ahead.")]
    public void A_row_it_cannot_book_is_refused_with_a_reason(string date, string? time, string reason)
    {
        var r = Nz(date, time);
        Assert.Null(r.BookDateTime);
        Assert.Equal(reason, r.Error);
    }

    [Fact]
    public void The_window_matches_the_validator()
    {
        // Validator: tenant now < BookDate < tenant today + 30 days (midnight).
        Assert.Null(Nz("17/11/2026", "10:01").Error);
        Assert.Null(Nz("16/12/2026", "23:59").Error);
        Assert.NotNull(Nz("17/12/2026", "00:00").Error);
    }
}
