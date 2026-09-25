using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Schedule;

/// <summary>
/// Result of a next-available-collection resolve. NextCollectionAt is
/// the earliest bookable pickup instant (day at StartTime). Reason names
/// the FIRST roll that occurred from the operator's booking-requested
/// day; if no roll occurred it is "no-roll". Vocabulary is fixed:
/// "no-roll", "cutoff-passed", "non-operating-day", "holiday-rolled".
/// </summary>
public record NextAvailableCollectionResult(
    DateTime NextCollectionAt,
    string Reason);

/// <summary>
/// F19b resolver contract (Steve, 2026-09-24). Given a schedule +
/// client + booking-requested moment, return the earliest bookable
/// collection instant. skipHolidays is set by the caller from the
/// per-booking tucJobBooking.HolidayDeliveryOption; F19b defers to the
/// caller and does NOT resolve HolidayDeliveryOption itself (Steve's
/// rule: skip-non-working logic respects the client's option, does not
/// override it).
/// </summary>
public interface IScheduleAvailabilityResolver
{
    Task<NextAvailableCollectionResult?> GetNextAvailableCollectionAsync(
        int scheduleId,
        int clientId,
        DateTime bookingRequestedAt,
        bool skipHolidays,
        CancellationToken ct = default);
}

/// <summary>
/// Steve F19b "next available collection" resolver (2026-09-24).
///
/// Reads the client-resolved day-row projection via
/// dbo.fnScheduleForClient(@ScheduleId, @ClientId) so F1 per-client
/// overrides (Steve 2026-09-22) fold in transparently, then walks the
/// candidate days forward from bookingRequestedAt honouring:
///   * operating-days mask (schedule shape, always respected),
///   * cutoff timing (F11 Phase C absolute pair, with legacy CutoffHours
///     fallback when the pair is unset),
///   * holidays IFF the caller passed skipHolidays = true. skipHolidays
///     comes from tucJobBooking.HolidayDeliveryOption at the call site;
///     F19b does not resolve it.
///
/// Returns null if no candidate is found within a 30-day defensive
/// window - the schedule is misconfigured if this hits.
/// </summary>
public class ScheduleAvailabilityService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory), IScheduleAvailabilityResolver
{
    // Defensive upper bound. If we walk 30 days without finding a
    // candidate the schedule has no operating days that survive the
    // cutoff + holiday filters, which is a data problem, not a runtime
    // one. The caller receives null and surfaces its own error.
    private const int MaxCandidateWindowDays = 30;

    /// <summary>
    /// Projection of the fnScheduleForClient TVF that F19b needs. Only
    /// the columns the algorithm reads are declared; the TVF returns
    /// several others (DisplayName, PickupZoneGroupId, etc.) which EF
    /// ignores as long as the SELECT list here matches this shape. Names
    /// match the TVF output columns 1:1.
    /// </summary>
    private sealed class DayRow
    {
        public short DayOfWeek { get; set; }
        public TimeSpan PickupWindowStart { get; set; }
        public int CutoffHours { get; set; }
        public byte? CutoffDay { get; set; }
        public TimeSpan? CutoffTime { get; set; }
    }

    public async Task<NextAvailableCollectionResult?> GetNextAvailableCollectionAsync(
        int scheduleId,
        int clientId,
        DateTime bookingRequestedAt,
        bool skipHolidays,
        CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();

        var rows = await LoadDayRowsAsync(scheduleId, clientId, ct);
        if (rows.Count == 0)
        {
            return null;
        }

        // Operating-day set + per-DoW row lookup. DayOfWeek in the TVF is
        // 1..7 (Mon..Sun ISO). A schedule can theoretically have >1 row
        // per DoW (e.g. multi-speed variants); the first wins - cutoff
        // + start-time semantics do not differ across those variants for
        // F19b's needs.
        var operatingDays = new HashSet<int>();
        var dayLookup = new Dictionary<int, DayRow>();
        foreach (var r in rows)
        {
            var dow = (int)r.DayOfWeek;
            if (dow < 1 || dow > 7) continue;
            operatingDays.Add(dow);
            dayLookup.TryAdd(dow, r);
        }
        if (operatingDays.Count == 0)
        {
            return null;
        }

        // Holidays: date-only set. Matching by SiteID is not needed here
        // (F19b does not know the client's site); a holiday on the
        // tenant applies to that tenant's schedule regardless of site
        // (CanBook = false marks the calendar entry). Kept broad on
        // purpose; the tenant DB is single-tenant per RoutedOps context.
        HashSet<DateTime> holidays;
        if (skipHolidays)
        {
            var holidayDates = await Context.TblHolidays.AsNoTracking()
                .Where(h => !h.CanBook)
                .Select(h => h.Date)
                .ToListAsync(ct);
            holidays = new HashSet<DateTime>(holidayDates.Select(d => d.Date));
        }
        else
        {
            holidays = new HashSet<DateTime>();
        }

        // Walk candidate days forward. firstReason locks in the FIRST
        // roll reason so the message reads "why did we roll from the
        // operator's asked-for day?" - subsequent rolls do not clobber
        // it.
        var candidate = bookingRequestedAt.Date;
        string? firstReason = null;
        for (int cursor = 0; cursor < MaxCandidateWindowDays; cursor++)
        {
            ct.ThrowIfCancellationRequested();

            var dow = ((int)candidate.DayOfWeek + 6) % 7 + 1;
            if (!operatingDays.Contains(dow))
            {
                firstReason ??= "non-operating-day";
                candidate = candidate.AddDays(1);
                continue;
            }

            var row = dayLookup[dow];
            var cutoffMoment = ComputeCutoffMoment(candidate, dow, row);
            if (bookingRequestedAt > cutoffMoment)
            {
                firstReason ??= "cutoff-passed";
                candidate = candidate.AddDays(1);
                continue;
            }

            if (skipHolidays && holidays.Contains(candidate.Date))
            {
                firstReason ??= "holiday-rolled";
                candidate = candidate.AddDays(1);
                continue;
            }

            return new NextAvailableCollectionResult(
                candidate.Date + row.PickupWindowStart,
                firstReason ?? "no-roll");
        }

        return null;
    }

    /// <summary>
    /// Load day rows for (scheduleId, clientId) via fnScheduleForClient
    /// on SQL Server; fall back to a direct TblBulkRunSchedule read for
    /// providers that do not support raw SQL (EF InMemory in tests). The
    /// fallback loses the client-override layer (fnScheduleForClient
    /// folds in F1 per-client deltas via COALESCE), which is acceptable
    /// for tests that do not seed override rows.
    /// </summary>
    private async Task<List<DayRow>> LoadDayRowsAsync(int scheduleId, int clientId, CancellationToken ct)
    {
        // Provider check via name instead of IsInMemory()/IsSqlite() so we
        // do not pull the EF InMemory package into the main project just
        // to detect the test provider. Anything not the SQL Server
        // provider falls through to the direct-DbSet path.
        var provider = Context.Database.ProviderName ?? string.Empty;
        var isSqlServer = provider.Contains("SqlServer", StringComparison.OrdinalIgnoreCase);
        if (!isSqlServer)
        {
            // Fallback path. Matches the TVF's column semantics for the
            // subset F19b needs, minus the override COALESCE.
            var raw = await Context.TblBulkRunSchedules.AsNoTracking()
                .Where(s => s.ScheduleId == scheduleId)
                .Select(s => new
                {
                    s.DayOfWeek,
                    s.StartTime,
                    s.CutoffHours,
                    s.CutoffDay,
                    s.CutoffTime,
                })
                .ToListAsync(ct);
            return raw
                .Where(s => s.DayOfWeek.HasValue && s.StartTime.HasValue)
                .Select(s => new DayRow
                {
                    DayOfWeek = s.DayOfWeek!.Value,
                    PickupWindowStart = s.StartTime!.Value,
                    CutoffHours = s.CutoffHours,
                    CutoffDay = s.CutoffDay,
                    CutoffTime = s.CutoffTime,
                })
                .ToList();
        }

        // Production path. Explicit SELECT list so the TVF-side column
        // order matches the DayRow property mapping - EF's SqlQuery<T>
        // matches by name, but pinning the projection keeps the query
        // narrow and self-documenting.
        const string sql =
            "SELECT DayOfWeek, PickupWindowStart, CutoffHours, CutoffDay, CutoffTime " +
            "FROM dbo.fnScheduleForClient(@ScheduleId, @ClientId)";
        return await Context.Database
            .SqlQueryRaw<DayRow>(
                sql,
                new SqlParameter("@ScheduleId", scheduleId),
                new SqlParameter("@ClientId", clientId))
            .ToListAsync(ct);
    }

    /// <summary>
    /// Absolute cutoff moment for the candidate date. Prefers the F11
    /// Phase C (CutoffDay, CutoffTime) pair; falls back to the legacy
    /// CutoffHours integer offset when the pair is unset.
    ///
    /// Day-offset math matches fnScheduleForClient / ScheduleService
    /// DeriveLegacyCutoffHours: ((CutoffDay - dow + 6) % 7) - 6, which
    /// produces 0 for same-day, -1 for one day prior, wrapping to -6.
    /// </summary>
    private static DateTime ComputeCutoffMoment(DateTime candidate, int dow, DayRow row)
    {
        if (row.CutoffDay.HasValue && row.CutoffTime.HasValue)
        {
            int dayOffset = ((row.CutoffDay.Value - dow + 6) % 7) - 6;
            return candidate.Date.AddDays(dayOffset) + row.CutoffTime.Value;
        }
        return candidate.Date + row.PickupWindowStart - TimeSpan.FromHours(row.CutoffHours);
    }
}
