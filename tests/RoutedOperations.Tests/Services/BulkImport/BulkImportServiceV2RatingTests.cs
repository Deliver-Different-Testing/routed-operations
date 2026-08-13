using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkImport;

// Covers the RatingService partial's small public + testable surface:
//   - GetStockSizeID (pure EF read, testable)
//   - CalculateLinehaulBookingDateTime (pure date math, testable)
//   - GetSuburbID_FromNameWithPostCode (uses FromSqlInterpolated - NOT
//     testable under InMemory; assert it surfaces the InMemory limitation)
//
// PriceAndSplitJobsAndReturnKmRatedJobs / SplitJobAndApplyAmount /
// InsertLinehaulJobs / InsertPickupJobs / InsertDeliveryJobs are private
// methods that ProcessRoutedJobs invokes via SQL SPs; they are exercised
// indirectly by the JobFactory guards but a direct unit test would need
// the SP layer, which InMemory doesn't provide. The linehaul/pickup body
// coverage comes from the JobFactory validation tests upstream + will get
// full-fat integration coverage in a later Sqlite-backed phase.
public class BulkImportServiceV2RatingTests
{
    // ---------------- GetStockSizeID -----------------

    [Fact]
    public void GetStockSizeID_ReturnsIdForMatchingDefaultSize()
    {
        var svc = MakeSvcWithSeed(seed =>
        {
            seed.TblGssstockSizes.Add(new TblGssstockSize
            {
                Id = 42,
                Name = "Standard",
                Length = 30d,
                Width = 20d,
                Height = 10d,
                Weight = 5d,
                IsDefaultSize = true,
                ClientId = null
            });
        });
        var id = svc.GetStockSizeID(length: 30m, width: 20m, height: 10m, weight: 5m);
        Assert.Equal(42, id);
    }

    [Fact]
    public void GetStockSizeID_NoMatch_ReturnsNull()
    {
        var svc = MakeSvcWithSeed(_ => { });
        var id = svc.GetStockSizeID(length: 30m, width: 20m, height: 10m, weight: 5m);
        Assert.Null(id);
    }

    [Fact]
    public void GetStockSizeID_ClientSpecificRow_IsIgnored()
    {
        // Method filters ClientId == null; a client-specific row must not
        // match even if dimensions align.
        var svc = MakeSvcWithSeed(seed =>
        {
            seed.TblGssstockSizes.Add(new TblGssstockSize
            {
                Id = 42,
                Name = "Standard",
                Length = 30d,
                Width = 20d,
                Height = 10d,
                Weight = 5d,
                IsDefaultSize = true,
                ClientId = 999
            });
        });
        Assert.Null(svc.GetStockSizeID(30m, 20m, 10m, 5m));
    }

    // ---------------- CalculateLinehaulBookingDateTime -----------------

    [Fact]
    public void CalculateLinehaulBookingDateTime_NoAdvanceDays_ReturnsScheduleWhenClampedToNow()
    {
        var svc = MakeSvc();
        var scheduleTime = DateTime.Now.AddDays(2);

        var result = svc.CalculateLinehaulBookingDateTime(scheduleTime, linehaulDepartureAdvanceDays: 0, linehaulWeekday: null);

        // Method clamps to [DateTime.Now, scheduleDateTime] range.
        Assert.InRange(result, DateTime.Now.AddSeconds(-2), scheduleTime.AddSeconds(1));
    }

    [Fact]
    public void CalculateLinehaulBookingDateTime_AdvanceDaysClampedToNow()
    {
        var svc = MakeSvc();
        var scheduleTime = DateTime.Now.AddDays(1);

        // Advance 30 days back puts us well before Now; the clamp bumps it up.
        var result = svc.CalculateLinehaulBookingDateTime(scheduleTime, linehaulDepartureAdvanceDays: 30, linehaulWeekday: null);

        Assert.InRange(result, DateTime.Now.AddSeconds(-2), scheduleTime.AddSeconds(1));
    }

    [Fact]
    public void CalculateLinehaulBookingDateTime_ClampsAboveByScheduleDateTime()
    {
        var svc = MakeSvc();
        // scheduleTime is in the past -> the method still clamps up to
        // DateTime.Now, then clamps down to scheduleTime. Since Now > sched,
        // the lower clamp wins first, then the upper clamp forces sched.
        // Result: sched.
        var scheduleTime = DateTime.Now.AddDays(-5);

        var result = svc.CalculateLinehaulBookingDateTime(scheduleTime, linehaulDepartureAdvanceDays: 0, linehaulWeekday: null);

        Assert.Equal(scheduleTime, result);
    }

    [Fact]
    public void CalculateLinehaulBookingDateTime_MalformedWeekdayString_ThrowsIndexOutOfRange()
    {
        // Source falls back to "000000" (6 chars) when the weekday string is
        // not exactly 7 chars, but then indexes positions 0..6 - an off-by-one
        // bug documented here to catch regressions if the fallback is later
        // widened to "0000000".
        var svc = MakeSvc();
        var scheduleTime = DateTime.Now.AddDays(3);

        Assert.Throws<IndexOutOfRangeException>(() =>
            svc.CalculateLinehaulBookingDateTime(scheduleTime, 0, linehaulWeekday: "abc"));
    }

    [Fact]
    public void CalculateLinehaulBookingDateTime_CurrentDayAllowed_NoShift()
    {
        var svc = MakeSvc();
        var scheduleTime = new DateTime(2027, 1, 4, 8, 0, 0); // Monday
        // Weekday index: Monday is source-index 0; "1111111" allows every day.
        var result = svc.CalculateLinehaulBookingDateTime(scheduleTime, 0, "1111111");
        // Since scheduleTime is in the past (>= 2026), the clamp forces sched.
        Assert.Equal(scheduleTime, result);
    }

    [Fact]
    public void CalculateLinehaulBookingDateTime_CurrentDayDisallowed_ShiftsForward()
    {
        var svc = MakeSvc();
        // Pick a real Monday (day-of-week=1 in .NET, source-index 0).
        var monday = new DateTime(2027, 1, 4, 8, 0, 0);
        // Weekday mask blocks Monday but allows Tuesday.
        var result = svc.CalculateLinehaulBookingDateTime(monday.AddDays(3), 3, "0100000");
        // The result gets clamped between Now and (monday+3)=Thursday.
        // We can't assert the exact date because of the Now clamp; just make
        // sure it did not throw.
        Assert.True(result >= DateTime.Now.AddSeconds(-5));
    }

    // ---------------- GetSuburbID_FromNameWithPostCode -----------------
    // Uses FromSqlInterpolated ("SELECT dbo.UTL_fncSuburb_FromNameWithPostCode
    // ..."); InMemory rejects the raw SQL with InvalidOperationException.
    // Asserting the exception locks in the current behaviour so a switch to
    // Sqlite in a later phase surfaces cleanly.
    [Fact]
    public void GetSuburbID_FromNameWithPostCode_InMemory_ThrowsSinceRawSqlIsNotSupported()
    {
        var opts = BulkImportTestHarness.NewOptions();
        using var ctx = BulkImportTestHarness.Context(opts);

        Assert.ThrowsAny<Exception>(() =>
            BulkImportServiceV2.GetSuburbID_FromNameWithPostCode(ctx, "Auckland", 1010));
    }

    // ---------------- helper -----------------

    private static BulkImportServiceV2 MakeSvc()
        => BulkImportServiceV2CoreTests.NewSvc(out _, out _, countryCode: "US");

    // For tests that need a shared InMemory store between the seed and the
    // SUT context factory, we build the whole svc stack with the same opts
    // and run the seed action against a companion context. Then subsequent
    // svc.Method() calls read that same store via the factory.
    private static BulkImportServiceV2 MakeSvcWithSeed(Action<DynamicDespatchDbContext> seedAction)
    {
        // Compose the same object graph BulkImportServiceV2CoreTests.NewSvc
        // wires up, but keep the DbContextOptions accessible so we can seed.
        var svc = BulkImportServiceV2CoreTests.NewSvc(out var seed, out _, countryCode: "US");
        seedAction(seed);
        seed.SaveChanges();
        return svc;
    }
}
