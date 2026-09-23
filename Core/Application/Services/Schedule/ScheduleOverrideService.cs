using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.Schedule;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.Schedule;

/// <summary>
/// Client-override delta service (Steve F1, 2026-09-20). Replaces the
/// clone-based BaseScheduleId create-override flow with per-client delta
/// rows on tblBulkRunScheduleOverride. See migration
/// 20260922123000_AddClientOverrideDeltas for the schema and the
/// resolver TVF fnScheduleForClient.
///
/// Contract:
///   - A schedule can have zero or more override rows per client, one
///     per scope (schedule / collection / delivery).
///   - Every schedule-scope row must carry at least one schedule field;
///     every leg-scope row must carry at least one leg field. CK checks
///     on the DB reject empty rows.
///   - The Header row's OverrideCount tracks the count of DISTINCT
///     clients with any delta row on this schedule. Maintained inside
///     the SaveChanges transaction so a booking-path caller can skip
///     the override table entirely when the count is 0.
///
/// Kept in a separate file from ScheduleService because the surface is
/// small, self-contained, and easier to test in isolation. The main
/// ScheduleService reads override state via
/// GetOverrideCountsForSchedulesAsync when it needs to render list-view
/// counts; it does not know about the delta shape otherwise.
/// </summary>
public class ScheduleOverrideService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    ILogger<ScheduleOverrideService> logger)
    : BaseService(contextFactory)
{
    private readonly ILogger<ScheduleOverrideService> _logger = logger;

    private static readonly string[] ValidScopes =
    {
        BulkRunScheduleOverride.ScopeSchedule,
        BulkRunScheduleOverride.ScopeCollection,
        BulkRunScheduleOverride.ScopeDelivery,
        BulkRunScheduleOverride.ScopeDepot,
    };

    // ─── READS ──────────────────────────────────────────────────────────

    /// <summary>
    /// Returns one entry per client that owns any delta row on the
    /// given schedule. Grouped by client, three scope blocks per row
    /// (schedule / collection / delivery). Clients with no delta rows
    /// are excluded.
    /// </summary>
    public async Task<List<ScheduleOverrideDto>> ListForScheduleAsync(int scheduleId)
    {
        var headerExists = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .AnyAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null);
        if (!headerExists)
        {
            return new List<ScheduleOverrideDto>();
        }

        var rows = await Context.BulkRunScheduleOverrides.AsNoTracking()
            .Where(o => o.ScheduleId == scheduleId)
            .ToListAsync();
        if (rows.Count == 0)
        {
            return new List<ScheduleOverrideDto>();
        }

        var clientIds = rows.Select(r => r.ClientId).Distinct().ToList();
        var clientLookup = await Context.TucClients.AsNoTracking()
            .Where(c => clientIds.Contains(c.UcclId))
            .Select(c => new { c.UcclId, c.UcclCode, c.UcclName })
            .ToDictionaryAsync(c => c.UcclId);

        return rows
            .GroupBy(r => r.ClientId)
            .Select(g =>
            {
                var scheduleRow  = g.FirstOrDefault(r => r.Scope == BulkRunScheduleOverride.ScopeSchedule);
                var collectionRow = g.FirstOrDefault(r => r.Scope == BulkRunScheduleOverride.ScopeCollection);
                var deliveryRow  = g.FirstOrDefault(r => r.Scope == BulkRunScheduleOverride.ScopeDelivery);
                var updatedUtc = g.Max(r => r.UpdatedUtc ?? r.CreatedUtc);
                var updatedBy  = g.OrderByDescending(r => r.UpdatedUtc ?? r.CreatedUtc)
                                  .Select(r => r.UpdatedBy ?? r.CreatedBy)
                                  .FirstOrDefault();
                clientLookup.TryGetValue(g.Key, out var client);
                return new ScheduleOverrideDto(
                    scheduleId,
                    g.Key,
                    client?.UcclCode,
                    client?.UcclName,
                    MapScheduleScope(scheduleRow),
                    MapLegScope(collectionRow),
                    MapLegScope(deliveryRow),
                    updatedUtc,
                    updatedBy);
            })
            .OrderBy(d => d.ClientCode ?? "~")
            .ToList();
    }

    /// <summary>
    /// Every schedule this client owns any delta on. Used by the
    /// client's "you differ from N schedules on..." view (Steve F1
    /// GET /api/v2/clients/{clientId}/overrides).
    /// </summary>
    public async Task<List<ClientOverrideRefDto>> ListForClientAsync(int clientId)
    {
        var rows = await Context.BulkRunScheduleOverrides.AsNoTracking()
            .Where(o => o.ClientId == clientId)
            .ToListAsync();
        if (rows.Count == 0)
        {
            return new List<ClientOverrideRefDto>();
        }

        var scheduleIds = rows.Select(r => r.ScheduleId).Distinct().ToList();
        var scheduleLookup = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => scheduleIds.Contains(h.ScheduleId) && h.RetiredUtc == null)
            .Select(h => new { h.ScheduleId, h.Name, h.DisplayName })
            .ToDictionaryAsync(h => h.ScheduleId);

        return rows
            .GroupBy(r => r.ScheduleId)
            .Where(g => scheduleLookup.ContainsKey(g.Key))
            .Select(g =>
            {
                var header = scheduleLookup[g.Key];
                var scopes = g.Select(r => r.Scope).Distinct().OrderBy(s => s).ToArray();
                var updatedUtc = g.Max(r => r.UpdatedUtc ?? r.CreatedUtc);
                return new ClientOverrideRefDto(
                    g.Key,
                    header.DisplayName ?? header.Name,
                    scopes,
                    updatedUtc);
            })
            .OrderByDescending(d => d.UpdatedUtc)
            .ToList();
    }

    /// <summary>
    /// Bulk read of OverrideCount for a set of schedules. Feeds the
    /// list-view badge ("+N clients"). O(1) lookup per schedule; the
    /// column is maintained transactionally by Put/Delete below.
    /// </summary>
    public async Task<IReadOnlyDictionary<int, int>> GetOverrideCountsAsync(IEnumerable<int> scheduleIds)
    {
        var ids = scheduleIds?.Distinct().ToList() ?? new List<int>();
        if (ids.Count == 0)
        {
            return new Dictionary<int, int>();
        }
        return await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => ids.Contains(h.ScheduleId))
            .Select(h => new { h.ScheduleId, h.OverrideCount })
            .ToDictionaryAsync(h => h.ScheduleId, h => h.OverrideCount);
    }

    // ─── WRITES ─────────────────────────────────────────────────────────

    /// <summary>
    /// Full replace of one client's delta on one schedule. Every scope
    /// in the request wipes and re-writes its row (or deletes it when
    /// the scope object is null / wholly-null). Header.OverrideCount is
    /// maintained inside the same SaveChanges transaction so a caller
    /// on the booking path can skip the override table when the count
    /// is 0.
    /// </summary>
    public async Task PutAsync(int scheduleId, int clientId, ScheduleOverridePutRequest req, string user)
    {
        var header = await Context.BulkRunScheduleHeaders
            .SingleOrDefaultAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null);
        if (header == null)
        {
            throw new InvalidOperationException($"Schedule {scheduleId} not found or retired.");
        }

        var clientExists = await Context.TucClients.AsNoTracking()
            .AnyAsync(c => c.UcclId == clientId);
        if (!clientExists)
        {
            throw new InvalidOperationException($"Client {clientId} not found.");
        }

        var existing = await Context.BulkRunScheduleOverrides
            .Where(o => o.ScheduleId == scheduleId && o.ClientId == clientId)
            .ToListAsync();

        var now = DateTime.UtcNow;
        var actor = string.IsNullOrWhiteSpace(user) ? "RoutedOps" : user;

        // Whichever rows exist for this client on this schedule, replace
        // them wholesale with what the request describes. Simpler and
        // safer than a per-scope diff, and the write cost is bounded
        // (at most 4 rows per client per schedule).
        if (existing.Count > 0)
        {
            Context.BulkRunScheduleOverrides.RemoveRange(existing);
        }

        var newRows = new List<BulkRunScheduleOverride>(4);
        var scheduleRow = BuildScheduleScopeRow(scheduleId, clientId, req.Schedule, now, actor);
        if (scheduleRow != null) newRows.Add(scheduleRow);

        var collectionRow = BuildLegScopeRow(scheduleId, clientId, BulkRunScheduleOverride.ScopeCollection, req.Collection, now, actor);
        if (collectionRow != null) newRows.Add(collectionRow);

        var deliveryRow = BuildLegScopeRow(scheduleId, clientId, BulkRunScheduleOverride.ScopeDelivery, req.Delivery, now, actor);
        if (deliveryRow != null) newRows.Add(deliveryRow);

        if (newRows.Count > 0)
        {
            await Context.BulkRunScheduleOverrides.AddRangeAsync(newRows);
        }

        // Update the header's OverrideCount to reflect the number of
        // distinct clients that will have any delta row after this
        // SaveChanges commits.
        header.OverrideCount = await CalculateOverrideCountAsync(scheduleId, clientId, addingRows: newRows.Count > 0);

        await Context.SaveChangesAsync();

        _logger.LogInformation(
            "Override upserted schedule={ScheduleId} client={ClientId} rows={RowCount} by {User}",
            scheduleId, clientId, newRows.Count, actor);
    }

    /// <summary>
    /// Delete every delta row this client has on this schedule. The
    /// client returns to the base schedule in full. Header.OverrideCount
    /// is decremented in the same transaction.
    /// </summary>
    public async Task DeleteAsync(int scheduleId, int clientId)
    {
        var header = await Context.BulkRunScheduleHeaders
            .SingleOrDefaultAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null);
        if (header == null)
        {
            return;
        }

        var existing = await Context.BulkRunScheduleOverrides
            .Where(o => o.ScheduleId == scheduleId && o.ClientId == clientId)
            .ToListAsync();
        if (existing.Count == 0)
        {
            return;
        }

        Context.BulkRunScheduleOverrides.RemoveRange(existing);
        header.OverrideCount = await CalculateOverrideCountAsync(scheduleId, clientId, addingRows: false);
        await Context.SaveChangesAsync();

        _logger.LogInformation(
            "Override deleted schedule={ScheduleId} client={ClientId}",
            scheduleId, clientId);
    }

    // ─── Internal helpers ───────────────────────────────────────────────

    /// <summary>
    /// Counts DISTINCT clients that will have any override row on this
    /// schedule after the pending write commits. Called inside the same
    /// unit of work as the Put/Delete so the resulting header value is
    /// consistent when SaveChanges flushes both entities.
    /// </summary>
    private async Task<int> CalculateOverrideCountAsync(int scheduleId, int currentClientId, bool addingRows)
    {
        // Count clients that have a persisted row and are NOT the client
        // we are currently rewriting.
        var persistedOtherClients = await Context.BulkRunScheduleOverrides
            .Where(o => o.ScheduleId == scheduleId && o.ClientId != currentClientId)
            .Select(o => o.ClientId)
            .Distinct()
            .CountAsync();
        return persistedOtherClients + (addingRows ? 1 : 0);
    }

    private BulkRunScheduleOverride BuildScheduleScopeRow(
        int scheduleId, int clientId, ScheduleScopeOverrideDto scope, DateTime now, string actor)
    {
        if (scope == null) return null;
        if (scope.CutoffHours == null && scope.CutoffDay == null && scope.CutoffTime == null
            && string.IsNullOrEmpty(scope.WeekDays) && scope.IsActive == null
            && string.IsNullOrEmpty(scope.DisplayName) && string.IsNullOrEmpty(scope.DisplayDescription))
        {
            return null;
        }
        return new BulkRunScheduleOverride
        {
            ScheduleId         = scheduleId,
            ClientId           = clientId,
            Scope              = BulkRunScheduleOverride.ScopeSchedule,
            LegOrdinal         = 0,
            DayOfWeek          = 0,
            CutoffHours        = scope.CutoffHours,
            CutoffDay          = scope.CutoffDay.HasValue ? (byte?)scope.CutoffDay.Value : null,
            CutoffTime         = ParseNullableTime(scope.CutoffTime),
            WeekDays           = string.IsNullOrEmpty(scope.WeekDays) ? null : scope.WeekDays,
            IsActive           = scope.IsActive,
            DisplayName        = string.IsNullOrEmpty(scope.DisplayName) ? null : scope.DisplayName,
            DisplayDescription = string.IsNullOrEmpty(scope.DisplayDescription) ? null : scope.DisplayDescription,
            CreatedUtc         = now,
            CreatedBy          = actor,
        };
    }

    private BulkRunScheduleOverride BuildLegScopeRow(
        int scheduleId, int clientId, string scopeName, LegScopeOverrideDto scope, DateTime now, string actor)
    {
        if (scope == null) return null;
        if (scope.SpeedId == null && scope.ZoneGroupId == null
            && string.IsNullOrEmpty(scope.PickupTimeMode)
            && string.IsNullOrEmpty(scope.PickupWindowStart)
            && string.IsNullOrEmpty(scope.PickupWindowEnd)
            && string.IsNullOrEmpty(scope.AdditionalItemChargingLogic))
        {
            return null;
        }
        if (!ValidScopes.Contains(scopeName))
        {
            throw new InvalidOperationException($"Unknown override scope: {scopeName}");
        }
        return new BulkRunScheduleOverride
        {
            ScheduleId                  = scheduleId,
            ClientId                    = clientId,
            Scope                       = scopeName,
            LegOrdinal                  = 0,
            DayOfWeek                   = 0,
            SpeedId                     = scope.SpeedId,
            ZoneGroupId                 = scope.ZoneGroupId,
            PickupTimeMode              = string.IsNullOrEmpty(scope.PickupTimeMode) ? null : scope.PickupTimeMode,
            PickupWindowStart           = ParseNullableTime(scope.PickupWindowStart),
            PickupWindowEnd             = ParseNullableTime(scope.PickupWindowEnd),
            AdditionalItemChargingLogic = string.IsNullOrEmpty(scope.AdditionalItemChargingLogic)
                ? null : scope.AdditionalItemChargingLogic,
            CreatedUtc                  = now,
            CreatedBy                   = actor,
        };
    }

    private static TimeSpan? ParseNullableTime(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return TimeSpan.TryParseExact(value, new[] { @"hh\:mm", @"hh\:mm\:ss" }, CultureInfo.InvariantCulture, out var t)
            ? t
            : (TimeSpan.TryParse(value, CultureInfo.InvariantCulture, out var loose) ? loose : (TimeSpan?)null);
    }

    private static ScheduleScopeOverrideDto MapScheduleScope(BulkRunScheduleOverride row)
    {
        if (row == null) return null;
        return new ScheduleScopeOverrideDto(
            row.CutoffHours,
            row.CutoffDay.HasValue ? (int?)row.CutoffDay.Value : null,
            FormatNullableTime(row.CutoffTime),
            row.WeekDays,
            row.IsActive,
            row.DisplayName,
            row.DisplayDescription);
    }

    private static LegScopeOverrideDto MapLegScope(BulkRunScheduleOverride row)
    {
        if (row == null) return null;
        return new LegScopeOverrideDto(
            row.SpeedId,
            row.ZoneGroupId,
            row.PickupTimeMode,
            FormatNullableTime(row.PickupWindowStart),
            FormatNullableTime(row.PickupWindowEnd),
            row.AdditionalItemChargingLogic);
    }

    private static string FormatNullableTime(TimeSpan? value)
        => value.HasValue ? value.Value.ToString(@"hh\:mm", CultureInfo.InvariantCulture) : null;
}
