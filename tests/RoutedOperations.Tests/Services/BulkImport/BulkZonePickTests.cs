using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain.Models;

namespace RoutedOperations.Tests.Services.BulkImport;

// NZ bulk import prices the delivery end on the rows dbo.UTL_fncBulkZone_ResolveAt
// returns, filtered like WS_stpJob_Scheduler_Rates filters @ToZones: the schedule's
// postcode group and its Region as the depot, then the zone must be active on the
// schedule. These cases use the Urgent prod shape: polygon 30 is zone 6 in group 11
// on depot 4, 3434 has its own zone 2 in group 11, and some postcodes also have
// rows on other depots or in no group.
public class BulkZonePickTests
{
    private const int Schedule = 50, Group11 = 11, Depot4 = 4;
    private static readonly BulkZonePick.ActiveZone[] NoActive = Array.Empty<BulkZonePick.ActiveZone>();

    private static ResolvedBulkZone Row(int? depot, int? group, int? zone) =>
        new() { DepotId = depot, PostcodeGroupId = group, Zone = zone };

    [Fact]
    public void PricingRow_takes_the_row_for_the_schedule_group_and_depot()
    {
        // Develop took the first row with no depot check, so this job priced on depot 2's zone 1.
        var rows = new[] { Row(2, Group11, 1), Row(Depot4, Group11, 6), Row(Depot4, null, 3) };

        var pick = BulkZonePick.PricingRow(rows, Schedule, Group11, Depot4, NoActive);

        Assert.NotNull(pick);
        Assert.Equal(Depot4, pick!.DepotId);
        Assert.Equal(6, pick.Zone);
    }

    [Fact]
    public void PricingRow_lowest_zone_wins_when_one_group_and_depot_has_two()
    {
        var a = new[] { Row(Depot4, Group11, 7), Row(Depot4, Group11, 2) };
        var b = new[] { Row(Depot4, Group11, 2), Row(Depot4, Group11, 7) };

        Assert.Equal(2, BulkZonePick.PricingRow(a, Schedule, Group11, Depot4, NoActive)!.Zone);
        Assert.Equal(2, BulkZonePick.PricingRow(b, Schedule, Group11, Depot4, NoActive)!.Zone);
    }

    [Fact]
    public void PricingRow_active_zone_wins_over_a_lower_inactive_one()
    {
        // Zones 2 and 7 both cover the job in group 11 on depot 4; only 7 is active, so the
        // job is zone-priced and must price on 7, not on the lower inactive 2.
        var rows = new[] { Row(Depot4, Group11, 2), Row(Depot4, Group11, 7) };
        var active = new[] { new BulkZonePick.ActiveZone(7, Depot4, Group11) };

        Assert.Equal(7, BulkZonePick.PricingRow(rows, Schedule, Group11, Depot4, active)!.Zone);
    }

    [Fact]
    public void PricingRow_active_needs_the_same_depot_and_group()
    {
        // Zone 7 is active only on depot 2 and on group 12, so neither counts for this row set.
        var rows = new[] { Row(Depot4, Group11, 2), Row(Depot4, Group11, 7) };
        var active = new[] { new BulkZonePick.ActiveZone(7, 2, Group11), new BulkZonePick.ActiveZone(7, Depot4, 12) };

        Assert.Equal(2, BulkZonePick.PricingRow(rows, Schedule, Group11, Depot4, active)!.Zone);
    }

    [Fact]
    public void PricingRow_puts_a_null_zone_last()
    {
        var rows = new[] { Row(Depot4, Group11, null), Row(Depot4, Group11, 5) };

        Assert.Equal(5, BulkZonePick.PricingRow(rows, Schedule, Group11, Depot4, NoActive)!.Zone);
    }

    [Fact]
    public void PricingRow_schedule_without_group_matches_only_no_group_rows()
    {
        var rows = new[] { Row(Depot4, Group11, 6), Row(Depot4, null, 3) };

        Assert.Equal(3, BulkZonePick.PricingRow(rows, Schedule, null, Depot4, NoActive)!.Zone);
    }

    [Fact]
    public void PricingRow_no_row_for_the_schedule_group_and_depot_is_null()
    {
        var rows = new[] { Row(2, Group11, 9), Row(Depot4, 12, 4) };

        Assert.Null(BulkZonePick.PricingRow(rows, Schedule, Group11, Depot4, NoActive));
        Assert.Null(BulkZonePick.PricingRow(Array.Empty<ResolvedBulkZone>(), Schedule, Group11, Depot4, NoActive));
    }

    [Fact]
    public void PricingRow_without_a_schedule_id_takes_any_row()
    {
        var rows = new[] { Row(2, Group11, 9), Row(Depot4, Group11, 6) };

        Assert.Equal(6, BulkZonePick.PricingRow(rows, null, null, null, NoActive)!.Zone);
    }

    [Fact]
    public void Polygon_example_3496_prices_zone_6_and_3434_keeps_zone_2()
    {
        // Switch on, 546 Tirau Road: the resolver gives 3496 the polygon row and 3434 its own row.
        var active = new[] { new BulkZonePick.ActiveZone(6, Depot4, Group11), new BulkZonePick.ActiveZone(2, Depot4, Group11) };
        var rows3496 = new[] { Row(Depot4, Group11, 6), Row(Depot4, null, 3) };
        var rows3434 = new[] { Row(Depot4, Group11, 2), Row(Depot4, null, 2) };

        Assert.True(BulkZonePick.IsInActiveZone(rows3496, active));
        Assert.Equal(6, BulkZonePick.PricingRow(rows3496, Schedule, Group11, Depot4, active)!.Zone);
        Assert.True(BulkZonePick.IsInActiveZone(rows3434, active));
        Assert.Equal(2, BulkZonePick.PricingRow(rows3434, Schedule, Group11, Depot4, active)!.Zone);
    }

    [Fact]
    public void IsInActiveZone_needs_the_same_zone_depot_and_group()
    {
        var active = new[] { new BulkZonePick.ActiveZone(6, Depot4, Group11) };

        Assert.True(BulkZonePick.IsInActiveZone(new[] { Row(Depot4, Group11, 6) }, active));
        Assert.False(BulkZonePick.IsInActiveZone(new[] { Row(2, Group11, 6) }, active));
        Assert.False(BulkZonePick.IsInActiveZone(new[] { Row(Depot4, 12, 6) }, active));
        Assert.False(BulkZonePick.IsInActiveZone(new[] { Row(Depot4, Group11, 2) }, active));
        // 3496 without coordinates: only its no-group row comes back, so a group-11 schedule is not zone-priced.
        Assert.False(BulkZonePick.IsInActiveZone(new[] { Row(Depot4, null, 3) }, active));
        Assert.False(BulkZonePick.IsInActiveZone(Array.Empty<ResolvedBulkZone>(), active));
    }

    [Fact]
    public void IsInActiveZone_null_group_matches_null_group()
    {
        var active = new[] { new BulkZonePick.ActiveZone(3, Depot4, null) };

        Assert.True(BulkZonePick.IsInActiveZone(new[] { Row(Depot4, null, 3) }, active));
        Assert.False(BulkZonePick.IsInActiveZone(new[] { Row(Depot4, Group11, 3) }, active));
    }

    [Theory]
    [InlineData("-37.9113", 90, "-37.9113")]
    [InlineData(" 175.5362 ", 180, "175.5362")]
    [InlineData("-37.12345678912", 90, "-37.123456789")]
    [InlineData("1e1", 90, "10")]
    [InlineData("90", 90, "90")]
    [InlineData("-37.1234567885", 90, "-37.123456789")] // midpoint away from zero, like SQL decimal(18,9)
    [InlineData("0.0000000005", 90, "0.000000001")]
    public void ParseCoordinate_reads_invariant_numbers(string raw, int limit, string want)
    {
        Assert.Equal(decimal.Parse(want, System.Globalization.CultureInfo.InvariantCulture),
            BulkZonePick.ParseCoordinate(raw, limit));
    }

    [Theory]
    [InlineData(null, 90)]
    [InlineData("", 90)]
    [InlineData("   ", 90)]
    [InlineData("abc", 90)]
    [InlineData("-37,9113", 90)]
    [InlineData("1,5", 90)] // comma is never a separator: not 1.5, not 15
    [InlineData("90.0001", 90)]
    [InlineData("-180.5", 180)]
    public void ParseCoordinate_blank_bad_or_out_of_range_is_null(string? raw, int limit)
    {
        Assert.Null(BulkZonePick.ParseCoordinate(raw, limit));
    }
}
