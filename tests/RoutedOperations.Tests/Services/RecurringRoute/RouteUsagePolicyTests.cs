using RoutedOperations.Core.Application.Dtos.RecurringRoute;

namespace RoutedOperations.Tests.Services.RecurringRoute;

/// <summary>
/// The policy behind a permanent route delete: which references block it,
/// and what the operator is told when one does.
///
/// Only the decision is tested here. The counting is raw SQL against
/// tables EF does not map (tucJob.RouteId and tblBulkJob.RouteId have no
/// mapped property), so it cannot run on the InMemory provider these
/// tests use; that half is verified by driving the real database.
///
/// Totes are absent on purpose and it is not an oversight: the app has
/// no SELECT grant on tblLinehaulTote, so they are enforced by the
/// foreign key and surfaced by the 547 handler in HardDeleteAsync
/// instead. See RouteUsageDto's remarks.
///
/// What IS worth pinning is the rule, because it is a destructive action
/// and because "which of these count" is a decision someone could
/// quietly narrow later.
/// </summary>
public class RouteUsagePolicyTests
{
    private static RouteUsageDto Usage(
        int jobs = 0, int bookings = 0, int bulkJobs = 0, int roster = 0,
        int zipcodes = 0, int schedules = 0, int polygons = 0) =>
        new(jobs, bookings, bulkJobs, roster, zipcodes, schedules, polygons);

    [Fact]
    public void A_route_nothing_points_at_is_deletable()
    {
        var u = Usage();
        Assert.True(u.IsUnused);
        Assert.Null(u.BlockReason());
    }

    [Theory]
    // All seven counted references, one per row. If any of these ever
    // stops blocking, the delete starts orphaning rows in that table.
    [InlineData("jobs")]
    [InlineData("bookings")]
    [InlineData("bulkJobs")]
    [InlineData("roster")]
    [InlineData("zipcodes")]
    [InlineData("schedules")]
    [InlineData("polygons")]
    public void Any_single_reference_blocks_the_delete(string field)
    {
        var u = field switch
        {
            "jobs" => Usage(jobs: 1),
            "bookings" => Usage(bookings: 1),
            "bulkJobs" => Usage(bulkJobs: 1),
            "roster" => Usage(roster: 1),
            "zipcodes" => Usage(zipcodes: 1),
            "schedules" => Usage(schedules: 1),
            _ => Usage(polygons: 1),
        };
        Assert.False(u.IsUnused);
        Assert.NotNull(u.BlockReason());
    }

    [Fact]
    public void Bookings_and_bulk_jobs_block_even_though_no_foreign_key_protects_them()
    {
        // The reason these two are counted at all. tucJobBooking.RouteId
        // and tblBulkJob.RouteId carry a route id with no FK behind them,
        // so the database would happily let the delete through and leave
        // the rows pointing at nothing. Steve's rule said "no bookings",
        // and bookings are one of the unprotected pair.
        Assert.False(Usage(bookings: 3).IsUnused);
        Assert.False(Usage(bulkJobs: 2).IsUnused);
    }

    [Fact]
    public void The_reason_names_every_blocker_not_just_the_first()
    {
        // An operator who clears jobs, retries, and is then refused for
        // the roster is being made to discover the list one round trip at
        // a time.
        var reason = Usage(jobs: 2, roster: 1, polygons: 4).BlockReason();

        Assert.Contains("2 jobs", reason);
        Assert.Contains("1 roster entry", reason);
        Assert.Contains("4 bound polygons", reason);
        // And it says what to do instead, because deactivate sits right
        // next to this action in the same menu.
        Assert.Contains("deactivate", reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_reason_gets_the_singular_and_plural_right()
    {
        var one = Usage(jobs: 1, polygons: 1).BlockReason();
        Assert.Contains("1 job,", one);
        Assert.DoesNotContain("1 jobs", one);
        Assert.Contains("1 bound polygon.", one);
        // Two blockers, so the follow-on is plural.
        Assert.Contains("Remove them first", one);

        // A single blocker of a single row reads "it", not "them" - the
        // first run of this said "1 bound schedule. Remove them first".
        Assert.Contains("Remove it first", Usage(schedules: 1).BlockReason());

        var many = Usage(jobs: 2, polygons: 2).BlockReason();
        Assert.Contains("2 jobs", many);
        Assert.Contains("2 bound polygons", many);
    }
}
