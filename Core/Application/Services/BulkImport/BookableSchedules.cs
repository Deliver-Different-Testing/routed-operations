using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.BulkImport;

/// <summary>
/// Day-row projection of tblBulkRunSchedule used by the Bulk Import wizard
/// (service / schedule pickers and depot bucketing).
/// </summary>
public sealed record BookableScheduleRow(
    int BulkRunScheduleId,
    int ScheduleId,
    string Name,
    int? Region,
    int? SpeedId,
    short? DayOfWeek,
    TimeSpan? StartTime,
    int CutoffHours);

/// <summary>
/// Loads the schedule day rows a client can actually book, applying the
/// same header + client-override rules as dbo.fnScheduleForClient for the
/// fields the wizard cares about:
///
///   - retired headers (RetiredUtc set) are excluded;
///   - IsActive resolves as COALESCE(override.IsActive, header.IsActive);
///   - a client WeekDays mask (7 chars, Mon..Sun, '1' = runs) removes day
///     rows for days the client does not run.
///
/// Day rows with no header row (pre-header legacy data) stay bookable.
/// Before 2026-09-28 the wizard read tblBulkRunSchedule filtered by client
/// only, so it offered (and auto-selected) retired or client-disabled
/// schedules - tester report 2026-09-22 (Christchurch).
/// </summary>
public static class BookableSchedules
{
    public static async Task<List<BookableScheduleRow>> LoadAsync(
        DynamicDespatchDbContext context,
        int clientId,
        CancellationToken ct = default)
    {
        var rows = await context.TblBulkRunSchedules
            .AsNoTracking()
            .Where(s => !s.ClientId.HasValue || s.ClientId == clientId)
            .Select(s => new BookableScheduleRow(
                s.BulkRunScheduleId,
                s.ScheduleId,
                s.Name,
                s.Region,
                s.SpeedId,
                s.DayOfWeek,
                s.StartTime,
                s.CutoffHours))
            .ToListAsync(ct);

        if (rows.Count == 0) return rows;

        var headerIds = rows.Select(r => r.ScheduleId).Distinct().ToList();

        var headers = await context.BulkRunScheduleHeaders
            .AsNoTracking()
            .Where(h => headerIds.Contains(h.ScheduleId))
            .Select(h => new { h.ScheduleId, h.IsActive, h.RetiredUtc })
            .ToDictionaryAsync(h => h.ScheduleId, ct);

        // Schedule-scope rows only. LegOrdinal / DayOfWeek are always 0
        // today; prefer the whole-week (DayOfWeek 0) row if more appear.
        var overrides = (await context.BulkRunScheduleOverrides
                .AsNoTracking()
                .Where(o => o.ClientId == clientId
                    && o.Scope == BulkRunScheduleOverride.ScopeSchedule
                    && headerIds.Contains(o.ScheduleId))
                .Select(o => new { o.ScheduleId, o.DayOfWeek, o.IsActive, o.WeekDays })
                .ToListAsync(ct))
            .GroupBy(o => o.ScheduleId)
            .ToDictionary(g => g.Key, g => g.OrderBy(o => o.DayOfWeek).First());

        return rows
            .Where(r =>
            {
                headers.TryGetValue(r.ScheduleId, out var header);
                overrides.TryGetValue(r.ScheduleId, out var ov);

                if (header?.RetiredUtc != null) return false;

                var isActive = ov?.IsActive ?? header?.IsActive ?? true;
                if (!isActive) return false;

                var mask = ov?.WeekDays;
                if (!string.IsNullOrEmpty(mask) && mask.Length == 7
                    && r.DayOfWeek is >= 1 and <= 7
                    && mask[r.DayOfWeek.Value - 1] == '0')
                {
                    return false;
                }

                return true;
            })
            .ToList();
    }
}
