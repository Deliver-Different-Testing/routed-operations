using RoutedOperations.API.Controllers;

namespace RoutedOperations.Tests.Controllers;

/// <summary>
/// S2 + S1 (2026-11-10). The Schedules NEW list search only matched the
/// schedule name, and the depot filter ran in the browser over the 50 rows of
/// the current page, so a depot whose schedules sat on page 2 showed nothing.
/// Both now run in GET /api/v2/schedules before paging.
/// </summary>
public class SchedulesV2ListFilterTests
{
    private static readonly HashSet<int> NoLinks = new();

    [Fact]
    public void Search_still_matches_the_schedule_name()
    {
        Assert.True(SchedulesV2Controller.MatchesSearch(1, "Auckland Metro", null, "metro", NoLinks));
    }

    [Fact]
    public void Search_matches_a_schedule_linked_to_a_client_whose_code_matches()
    {
        Assert.True(SchedulesV2Controller.MatchesSearch(7, "Auckland Metro", null, "ACME", new HashSet<int> { 7 }));
        Assert.False(SchedulesV2Controller.MatchesSearch(8, "Auckland Metro", null, "ACME", new HashSet<int> { 7 }));
    }

    [Fact]
    public void Search_matches_the_legacy_per_client_code()
    {
        Assert.True(SchedulesV2Controller.MatchesSearch(1, "Auckland Metro", "ACME", "acm", NoLinks));
    }

    [Fact]
    public void Depot_filter_matches_origin_depot_or_delivery_region_by_name()
    {
        var wanted = SchedulesV2Controller.ParseDepots("Auckland|Hamilton");

        Assert.True(SchedulesV2Controller.MatchesDepots("auckland", null, wanted));
        Assert.True(SchedulesV2Controller.MatchesDepots(null, "Hamilton", wanted));
        Assert.False(SchedulesV2Controller.MatchesDepots("Wellington", "Napier", wanted));
    }

    [Fact]
    public void No_depot_filter_keeps_every_row()
    {
        Assert.True(SchedulesV2Controller.MatchesDepots(null, null, SchedulesV2Controller.ParseDepots(null)));
    }
}
