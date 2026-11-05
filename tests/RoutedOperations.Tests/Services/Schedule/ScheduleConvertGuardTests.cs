using RoutedOperations.Core.Application.Services.Schedule;
using Xunit;
using static RoutedOperations.Core.Application.Services.Schedule.ScheduleConvertGuard;

namespace RoutedOperations.Tests.Services.Schedule;

/// <summary>
/// Steve's 5 Nov ruling: a save must not convert a schedule the view and the
/// booking cutoff check would then read wrongly. These pin the guard to the Step F
/// script's HOLD_EXCEPTIONS and HOLD_HOURS_ONLY, so a save and the batch hold the
/// same schedules. Days are 1 = Monday .. 7 = Sunday.
/// </summary>
public class ScheduleConvertGuardTests
{
    private static readonly TimeSpan Three = new(15, 0, 0);
    private static readonly TimeSpan Five = new(17, 0, 0);

    private static string Reason(params Day[] days) => RefusalReason(days);

    [Fact]
    public void Same_day_cutoff_on_every_day_is_one_rule_even_though_the_stored_day_differs()
    {
        // If this compared the stored CutoffDay, every ordinary same-day
        // schedule would be held and nothing would collapse on save again.
        Assert.Null(Reason(new Day(1, 1, Three, 2), new Day(2, 2, Three, 2), new Day(3, 3, Three, 2)));
    }

    [Fact]
    public void One_working_day_before_is_one_rule_across_a_weekend()
    {
        // Monday cut off Friday and Tuesday cut off Monday are the same rule.
        Assert.Null(Reason(new Day(1, 5, Three, 65), new Day(2, 1, Three, 17)));
    }

    [Fact]
    public void A_sunday_cutoff_for_monday_falls_back_to_calendar_days_and_can_still_agree()
    {
        Assert.Null(Reason(new Day(1, 7, Three, 17), new Day(2, 1, Three, 17)));
    }

    [Fact]
    public void The_same_stored_cutoff_day_on_different_runs_is_a_different_rule()
    {
        // Monday and Tuesday runs both cut off on Monday: 0 and 1 days before.
        Assert.Equal(CutoffsDifferReason, Reason(new Day(1, 1, Three, 2), new Day(2, 1, Three, 17)));
    }

    [Fact]
    public void A_different_cutoff_time_differs()
    {
        Assert.Equal(CutoffsDifferReason, Reason(new Day(1, 1, Three, 2), new Day(2, 2, Five, 0)));
    }

    [Fact]
    public void The_unit_is_chosen_for_the_whole_schedule()
    {
        // Monday-Friday and Tuesday-Monday agree in working days, but Wednesday
        // cut off Sunday forces calendar days on every row: 3, 1 and 3.
        Assert.Equal(
            CutoffsDifferReason,
            Reason(new Day(1, 5, Three, 65), new Day(2, 1, Three, 17), new Day(3, 7, Three, 65)));
    }

    [Fact]
    public void A_day_with_no_cutoff_next_to_a_day_with_one_differs()
    {
        Assert.Equal(CutoffsDifferReason, Reason(new Day(1, 1, Three, 2), new Day(2, null, null, 0)));
    }

    [Fact]
    public void Hours_with_no_cutoff_day_is_hours_only()
    {
        Assert.Equal(HoursOnlyReason, Reason(new Day(1, null, null, 999), new Day(2, null, null, 999)));
    }

    [Fact]
    public void One_hours_only_day_among_days_with_none_is_enough()
    {
        // The script sums HoursOnly over the rows. Null is treated as 0.
        Assert.Equal(HoursOnlyReason, Reason(new Day(1, null, null, 24), new Day(2, null, null, null)));
    }

    [Fact]
    public void A_cutoff_time_without_a_day_does_not_stop_it_being_hours_only()
    {
        Assert.Equal(HoursOnlyReason, Reason(new Day(1, null, Three, 24)));
    }

    [Fact]
    public void Differing_cutoffs_are_reported_ahead_of_hours_only()
    {
        // Same order as the script's Disposition CASE.
        Assert.Equal(CutoffsDifferReason, Reason(new Day(1, 1, Three, 2), new Day(2, null, null, 24)));
    }

    [Fact]
    public void No_cutoff_at_all_is_not_held()
    {
        // The script gives this ExcDays = 0 and HoursOnly = 0, and the view has
        // nothing to lose: no cutoff before and no cutoff after.
        Assert.Null(Reason(new Day(1, null, null, 0), new Day(2, null, null, null)));
    }

    [Fact]
    public void Hours_that_disagree_with_a_cutoff_pair_are_not_held()
    {
        // HOLD_HOURS_DRIFT, which Steve did not name. The pair is what the
        // booking cutoff reads, so a stale offset beside it does not stop this.
        Assert.Null(Reason(new Day(1, 1, Three, 999), new Day(2, 2, Three, 2)));
    }

    [Fact]
    public void Nothing_to_judge_is_left_to_the_procedure()
    {
        Assert.Null(Reason());
    }

    [Fact]
    public void A_weekday_outside_one_to_seven_is_left_to_the_procedure()
    {
        // No unit expresses it, and the procedure refuses it by name.
        Assert.Null(Reason(new Day(9, 1, Three, 2), new Day(1, 1, Three, 2)));
    }
}
