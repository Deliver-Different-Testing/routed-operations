// Ported verbatim from CourierManager
// (couriermanager/Core/Application/Utilities/ScheduleUtility.cs, 46
// lines, 3 static methods). No tenant dependence - pure schedule
// arithmetic. Renamed to DriverSchedulingUtility so it doesn't
// collide with the RoutedOperations booking-Schedule module.
//
// Guards:
//   HasStarted           - true if the schedule's Start has passed
//                          under the current tenant clock.
//   HasNotEnded          - true if the schedule's End is still in
//                          the future under the current tenant clock.
//   HasConflictingSchedule - overlap check against a peer set. Two
//                            modes: any-overlap OR notification-sent-
//                            overlap (used when the operator flips a
//                            response to Available and we need to
//                            block same-time double-booking).
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Utilities;

public static class DriverSchedulingUtility
{
    public static bool HasStarted(CourierSchedule schedule, DateTime tenantTime)
    {
        return schedule.BookDate.Date < tenantTime.Date
            || (schedule.BookDate.Date == tenantTime.Date
                && schedule.StartTime.ToTimeSpan() <= tenantTime.TimeOfDay);
    }

    public static bool HasNotEnded(CourierSchedule schedule, DateTime tenantTime)
    {
        return schedule.BookDate.Date > tenantTime.Date
            || !(schedule.BookDate.Date == tenantTime.Date
                && schedule.EndTime.ToTimeSpan() <= tenantTime.TimeOfDay);
    }

    public static bool HasConflictingSchedule(
        CourierSchedule schedule,
        IEnumerable<CourierSchedule> schedules,
        bool checkNotificationSent = false)
    {
        return checkNotificationSent
            ? schedules.Any(s => s.NotificationSent.HasValue
                                 && s.Id != schedule.Id
                                 && ((s.StartTime >= schedule.StartTime && s.StartTime < schedule.EndTime)
                                     || (s.EndTime > schedule.StartTime && s.EndTime <= schedule.EndTime)
                                     || (s.StartTime <= schedule.StartTime && s.EndTime >= schedule.EndTime)))
            : schedules.Any(s => s.Id != schedule.Id
                                 && s.BookDate.Date == schedule.BookDate.Date
                                 && ((s.StartTime >= schedule.StartTime && s.StartTime < schedule.EndTime)
                                     || (s.EndTime > schedule.StartTime && s.EndTime <= schedule.EndTime)
                                     || (s.StartTime <= schedule.StartTime && s.EndTime >= schedule.EndTime)));
    }

    public static bool IsScheduleConflicting(CourierSchedule schedule, CourierSchedule schedule2)
    {
        return schedule.Id != schedule2.Id
            && schedule.BookDate.Date == schedule2.BookDate.Date
            && ((schedule.StartTime >= schedule2.StartTime && schedule.StartTime < schedule2.EndTime)
                || (schedule.EndTime > schedule2.StartTime && schedule.EndTime <= schedule2.EndTime)
                || (schedule.StartTime <= schedule2.StartTime && schedule.EndTime >= schedule2.EndTime));
    }
}
