using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.Schedule;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.Schedule;

/// <summary>
/// Schedule module service.
///
/// Rewired 2026-09-08 (AddScheduleHeaderAndIdKeyedLinks) so a "schedule
/// group" is a `tblBulkRunScheduleHeader` row. Column names were
/// renamed 2026-09-09 (RenameScheduleIdToClarifyKeySpace) to remove
/// the collision with the day-row PK:
///
///   tblBulkRunScheduleHeader.ScheduleId       - header PK (identity)
///   tblBulkRunSchedule.ScheduleId             - day-row FK to header
///   tblBulkRunSchedule.BulkRunScheduleId      - day-row PK (legacy, unchanged)
///   tblScheduleClient.(ScheduleId, ClientId)  - link table PK/FK
///
/// Postcode + polygon junctions still key on ScheduleName (out of scope).
///
/// Public API keeps the (Name, LegacyClientId) tuple as the group
/// identifier for one release so existing consumers do not break; the
/// tuple is resolved to a header entity internally at the top of each
/// entry point. New scheduleId-based overloads live alongside for
/// callers that want the modern shape.
///
/// Resolution rule (Kevin 2026-09-08, brief §3):
///   A client's schedules are the live headers it has a link row for.
///   If it has none, its schedules are the live headers with
///   IsDefault = 1.
/// </summary>
public class ScheduleService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    ILogger<ScheduleService> logger,
    TenantScopedCache cache)
    : BaseService(contextFactory)
{
    private readonly ILogger<ScheduleService> _logger = logger;

    // Cache key + TTL for ListSummaryAsync (all-live browse path only).
    // 30s matches the frontend's React Query staleTime so a rapid
    // tab-switch or refetch cycle (invalidate + re-render) serves from
    // memory instead of re-hitting the DB. Every write path calls
    // InvalidateListSummaryCache below so operator mutations still
    // surface immediately. Per-client and legacy-flag entry points are
    // NOT cached: they hit different code paths and are only called by
    // niche legacy views; safer to leave them uncached than to grow the
    // invalidation surface.
    private const string AllLiveListCacheKey = "schedules-v2:list-summary:all-live";
    private static readonly TimeSpan ListSummaryCacheTtl = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Wipes the all-live ListSummaryAsync cache for the current tenant.
    /// Called from every mutation so operator writes surface on the next
    /// read without waiting for the 30s TTL. O(1).
    /// </summary>
    private void InvalidateListSummaryCache()
    {
        cache.Invalidate(AllLiveListCacheKey);
    }

    // ─── READS ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Slim list-view projection used by the Schedules tab. Server-side
    /// aggregates on the junction / zone / linehaul tables so the initial
    /// page load stays sub-500ms even on tenants with 2k+ schedules.
    ///
    /// `includeClientSpecific`:
    ///   - false (default): only "default" headers (IsDefault=1 with no
    ///     link rows scoped to a specific client). Fastest.
    ///   - true: every live header, regardless of link state. Used by the
    ///     Schedules tab search box so operators can find a per-client
    ///     schedule by name without knowing the client code up front.
    /// </summary>
    public async Task<List<ScheduleGroupSummaryDto>> ListSummaryAsync(int? clientId, bool includeClientSpecific = false, bool includeAllLive = false)
    {
        // Response cache for the heavy all-live browse path. This is the
        // path hit by /api/v2/schedules ?type=all which drives the
        // Schedules NEW page's main table + tab-count badge. On a 2k+
        // schedule tenant the underlying enrichment is 2-3s of network
        // round-trips; a 30s cache turns every subsequent request in the
        // window into ~10ms. Every mutation entry point in this service
        // calls InvalidateListSummaryCache so operator writes still
        // surface immediately.
        if (includeAllLive && clientId == null && !includeClientSpecific)
        {
            return await cache.GetOrSetAsync(
                AllLiveListCacheKey,
                ListSummaryCacheTtl,
                ComputeListSummaryAsync,
                sliding: false);
        }
        return await ListSummaryUncachedAsync(clientId, includeClientSpecific, includeAllLive);

        Task<List<ScheduleGroupSummaryDto>> ComputeListSummaryAsync() =>
            ListSummaryUncachedAsync(clientId, includeClientSpecific, includeAllLive);
    }

    private async Task<List<ScheduleGroupSummaryDto>> ListSummaryUncachedAsync(int? clientId, bool includeClientSpecific, bool includeAllLive)
    {
        // Perf 2026-09-17 v2: v1 parallelization dropped 11 sequential
        // round-trips to 3 waves (~5s -> ~3s). v2 pushes the three
        // junction "fetch full table then group-by in memory" queries
        // (zones, linehaul legs, RouteSchedule) to SQL-side GROUP BY so
        // we ship pre-aggregated counts instead of tens of thousands of
        // raw rows. Also adds per-task Stopwatch timing so we can spot
        // any remaining bottleneck query from the log without another
        // profiling pass.
        var totalSw = Stopwatch.StartNew();

        static Task<(T Result, long ElapsedMs)> Timed<T>(Func<Task<T>> fn) =>
            Task.Run(async () =>
            {
                var sw = Stopwatch.StartNew();
                var r = await fn().ConfigureAwait(false);
                sw.Stop();
                return (r, sw.ElapsedMilliseconds);
            });

        // ─── Wave 1: independent lookups. All 8 queries fire together.
        //          Every "count-per-scheduleId" is now a SQL-side GROUP BY
        //          returning ~thousands of small rows instead of full
        //          junction tables. RouteSchedule aggregation is the
        //          biggest single win: previously shipped every row of a
        //          potentially 100k+-row junction, now ships a single count
        //          per day-row via COUNT + DISTINCT in the DB.
        var depotNamesTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TblBulkRegions.AsNoTracking()
                .ToDictionaryAsync(r => r.BulkRegionId, r => r.Name);
        });
        var speedNamesTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TucJobTypes.AsNoTracking()
                .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);
        });
        var headersTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.BulkRunScheduleHeaders.AsNoTracking()
                .Where(h => h.RetiredUtc == null)
                .ToListAsync();
        });
        var postcodeCountsTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.SchedulePostcodes.AsNoTracking()
                .GroupBy(x => x.ScheduleName)
                .Select(g => new { Name = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Name, x => x.Count);
        });
        var polygonCountsTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.SchedulePolygons.AsNoTracking()
                .GroupBy(x => x.ScheduleName)
                .Select(g => new { Name = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Name, x => x.Count);
        });
        // SQL-side aggregate: one row per day-row (BulkRunScheduleId) with
        // its active-zone count. Retired-header day rows are filtered out
        // downstream via TryGetValue since they never appear in
        // allScheduleIds.
        var zoneCountsTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.BulkZoneSchedules.AsNoTracking()
                .Where(z => z.Active == true && z.ScheduleId.HasValue)
                .GroupBy(z => z.ScheduleId!.Value)
                .Select(g => new { ScheduleId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.ScheduleId, x => x.Count);
        });
        // Linehaul aggregate: for each day-row with an active leg, take
        // the MIN LinehaulRunId (deterministic pick for the "LH XYZ-ABC"
        // chip render below). We only need to know (a) does this day-row
        // have an active leg (dictionary presence), and (b) if so, one
        // representative run id (dictionary value). Ships 1 row per
        // active-day-row instead of every leg.
        var linehaulByDayRowTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TblBulkScheduleLinehauls.AsNoTracking()
                .Where(l => l.Active == true && l.BulkRunScheduleId.HasValue)
                .GroupBy(l => l.BulkRunScheduleId!.Value)
                .Select(g => new
                {
                    DayRowId = g.Key,
                    // Nullable-int Min: null when no leg on this day-row
                    // has a LinehaulRunId (rare - a leg without a run id
                    // never renders the chip anyway).
                    RunId = g.Min(x => x.LinehaulRunId),
                })
                .ToDictionaryAsync(x => x.DayRowId, x => x.RunId);
        });
        // RouteSchedule aggregate: distinct RouteId count per day-row.
        // The previous "fetch whole junction" step was the biggest single
        // wire cost on 2k-schedule tenants; SQL-side COUNT DISTINCT ships
        // ~thousands of ints instead of every row.
        var routeCountByDayRowTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.Set<Dictionary<string, object>>("RouteSchedule")
                .GroupBy(rs => EF.Property<int>(rs, "ScheduleId"))
                .Select(g => new
                {
                    DayRowId = g.Key,
                    RouteCount = g.Select(rs => EF.Property<int>(rs, "RouteId")).Distinct().Count(),
                })
                .ToDictionaryAsync(x => x.DayRowId, x => x.RouteCount);
        });
        // Referenced linehaul runs. Independent of allScheduleIds - just
        // "every run id used by an active leg on this tenant". Runs
        // are a small table (dozens per tenant) so we can fetch details
        // without waiting for downstream context.
        var linehaulRunsTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return (await ctx.TblbulkLinehaulRuns.AsNoTracking()
                .Where(r => ctx.TblBulkScheduleLinehauls
                    .Any(l => l.Active == true && l.LinehaulRunId == r.Id))
                .Select(r => new { r.Id, r.FromDepotId, r.ToDepotId, r.StartTime })
                .ToListAsync())
                .ToDictionary(r => r.Id, r => (r.FromDepotId, r.ToDepotId, r.StartTime));
        });

        await Task.WhenAll(
            depotNamesTask, speedNamesTask, headersTask,
            postcodeCountsTask, polygonCountsTask,
            zoneCountsTask, linehaulByDayRowTask, routeCountByDayRowTask,
            linehaulRunsTask);

        var (depotNames, w1DepotMs) = depotNamesTask.Result;
        var (speedNames, w1SpeedMs) = speedNamesTask.Result;
        var (headers, w1HeadersMs) = headersTask.Result;
        var (postcodeCountByName, w1PostcodeMs) = postcodeCountsTask.Result;
        var (polygonCountByName, w1PolygonMs) = polygonCountsTask.Result;
        var (zoneCountByDayRowId, w1ZoneMs) = zoneCountsTask.Result;
        var (linehaulByDayRow, w1LinehaulMs) = linehaulByDayRowTask.Result;
        var (routeCountByDayRow, w1RouteMs) = routeCountByDayRowTask.Result;
        var (linehaulRuns, w1RunsMs) = linehaulRunsTask.Result;

        var headersById = headers.ToDictionary(h => h.ScheduleId);
        var liveHeaderIds = new HashSet<int>(headers.Select(h => h.ScheduleId));

        // ─── Wave 2: link rows + day rows, both scoped to liveHeaderIds. ───
        var linkRowsTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.ScheduleClients.AsNoTracking()
                .Where(sc => liveHeaderIds.Contains(sc.ScheduleId))
                .Select(x => new { x.ScheduleId, x.ClientId })
                .ToListAsync();
        });
        var rowBasesTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TblBulkRunSchedules.AsNoTracking()
                .Where(s => liveHeaderIds.Contains(s.ScheduleId))
                .Select(s => new
                {
                    s.BulkRunScheduleId,
                    s.ScheduleId,
                    LegacyClientId = s.ClientId,
                    s.Region,
                    s.SpeedId,
                    s.DayOfWeek,
                    s.AutoBook,
                    s.PickupDepotId,
                    s.StartTime,
                    s.EndTime,
                    s.CutoffHours,
                    s.Description,
                })
                .ToListAsync();
        });
        // F3 (2026-09-23): "differs on" hint for the list-view badge is
        // now derived server-side from the delta table. One DISTINCT
        // fetch of (ScheduleId, Scope) - bounded by
        // #schedules * (schedule|collection|delivery|depot) worst case,
        // in practice a few hundred rows even on the biggest tenants.
        // Consumers render a friendly comma-joined list.
        var overrideScopeRowsTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.BulkRunScheduleOverrides.AsNoTracking()
                .Where(o => liveHeaderIds.Contains(o.ScheduleId))
                .Select(o => new { o.ScheduleId, o.Scope })
                .Distinct()
                .ToListAsync();
        });
        await Task.WhenAll(linkRowsTask, rowBasesTask, overrideScopeRowsTask);
        var (linkRows, w2LinkMs) = linkRowsTask.Result;
        var (rowBases, w2RowsMs) = rowBasesTask.Result;
        var (overrideScopeRows, w2OverrideScopeMs) = overrideScopeRowsTask.Result;

        // (ScheduleId -> ordered scope list) for the list-view "differs
        // on:" badge. Scopes ordered schedule/collection/depot/delivery
        // so the badge reads left to right by chain position.
        var overrideScopesByScheduleId = overrideScopeRows
            .GroupBy(r => r.ScheduleId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(r => r.Scope)
                      .Distinct()
                      .OrderBy(s => s switch
                      {
                          "schedule"   => 0,
                          "collection" => 1,
                          "depot"      => 2,
                          "delivery"   => 3,
                          _ => 99,
                      })
                      .ToArray());

        var linkClientsByHeaderId = linkRows
            .GroupBy(x => x.ScheduleId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ClientId).ToHashSet());

        // Fold the SQL-aggregated per-day-row counts to a per-header count
        // using dayRowToHeader. Preserves the pre-refactor semantics:
        //   * zone count per header = MAX zone count across its day rows
        //     (a header's day rows typically share a zone set, so max is
        //     the "the" count).
        //   * hasLh = any day row has an active leg.
        //   * route count per header = sum of distinct RouteIds across
        //     day rows. If a route binds to multiple day rows of the same
        //     header this overcounts vs the pre-refactor code, but that
        //     is an unusual data shape and the surrounding UI just shows
        //     "N routes"; a small overcount is acceptable trade for a
        //     100x wire-payload reduction.
        var dayRowToHeader = rowBases.ToDictionary(r => r.BulkRunScheduleId, r => r.ScheduleId);

        // ─── Wave 3: merged client codes (single TucClients round-trip). ─
        var legacyClientIds = headers
            .Where(h => h.LegacyClientId.HasValue)
            .Select(h => h.LegacyClientId!.Value)
            .Distinct()
            .ToList();
        var allClientIdsForCodes = linkClientsByHeaderId.Values
            .SelectMany(s => s)
            .Concat(legacyClientIds)
            .Distinct()
            .ToList();

        var clientCodesTask = Timed(async () =>
        {
            if (allClientIdsForCodes.Count == 0)
                return new Dictionary<int, string>();
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TucClients.AsNoTracking()
                .Where(c => allClientIdsForCodes.Contains(c.UcclId) && c.UcclCode != null)
                .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);
        });
        var (clientCodes, w3ClientMs) = await clientCodesTask;
        // legacyClientCodes was a strict subset of clientCodes pre-refactor
        // (same table, different filter). Consumers below only ever look up
        // legacy ids via TryGetValue, so pointing them at the merged dict
        // is equivalent - the extra entries are inert.
        var legacyClientCodes = clientCodes;

        totalSw.Stop();
        _logger.LogInformation(
            "ListSummaryAsync perf: total={TotalMs}ms | " +
            "w1[depot={W1DepotMs} speed={W1SpeedMs} headers={W1HeadersMs} " +
            "postcode={W1PostcodeMs} polygon={W1PolygonMs} zone={W1ZoneMs} " +
            "linehaul={W1LinehaulMs} route={W1RouteMs} runs={W1RunsMs}]ms | " +
            "w2[link={W2LinkMs} rows={W2RowsMs}]ms | " +
            "w3[client={W3ClientMs}]ms | " +
            "headers={HeaderCount} dayRows={DayRowCount}",
            totalSw.ElapsedMilliseconds,
            w1DepotMs, w1SpeedMs, w1HeadersMs, w1PostcodeMs, w1PolygonMs,
            w1ZoneMs, w1LinehaulMs, w1RouteMs, w1RunsMs,
            w2LinkMs, w2RowsMs, w3ClientMs,
            headers.Count, rowBases.Count);

        // Group day rows by ScheduleId (their header FK).
        // Each header emits one summary row.
        var summaries = rowBases
            .GroupBy(r => r.ScheduleId)
            .Where(g => headersById.ContainsKey(g.Key))
            .Select(g =>
            {
                var header = headersById[g.Key];
                var first = g.First();
                var activeDays = g
                    .Select(x => (int)(x.DayOfWeek ?? 0))
                    .Where(d => d > 0)
                    .Distinct()
                    .OrderBy(d => d)
                    .ToArray();
                var activeZones = g
                    .Select(x => zoneCountByDayRowId.TryGetValue(x.BulkRunScheduleId, out var c) ? c : 0)
                    .DefaultIfEmpty(0).Max();
                var hasLh = g.Any(x => linehaulByDayRow.ContainsKey(x.BulkRunScheduleId));

                // Origin depot: first non-null PickupDepotId across day
                // rows. Null = pickup from client address (rendered by
                // the frontend as "Client address").
                var pickupDepotId = g.FirstOrDefault(x => x.PickupDepotId.HasValue)?.PickupDepotId;
                var pickupDepotName = pickupDepotId.HasValue && depotNames.TryGetValue(pickupDepotId.Value, out var pdn)
                    ? pdn : null;

                // Window: earliest StartTime to latest EndTime across
                // day rows. Formatted as "HH:mm" to match Steve's
                // "08:00-10:00" copy.
                var startTimes = g.Where(x => x.StartTime.HasValue).Select(x => x.StartTime!.Value).ToArray();
                var endTimes = g.Where(x => x.EndTime.HasValue).Select(x => x.EndTime!.Value).ToArray();
                var windowStart = startTimes.Length > 0
                    ? startTimes.Min().ToString(@"hh\:mm")
                    : null;
                var windowEnd = endTimes.Length > 0
                    ? endTimes.Max().ToString(@"hh\:mm")
                    : null;

                // Cut-off split: Monday's value + the most common
                // non-Monday value so Steve's "65/17h" chip renders.
                var monRow = g.FirstOrDefault(x => x.DayOfWeek == 1);
                var monCutoff = monRow?.CutoffHours;
                var otherCutoffs = g
                    .Where(x => x.DayOfWeek != 1 && x.DayOfWeek.HasValue)
                    .Select(x => (int?)x.CutoffHours)
                    .ToArray();
                int? otherCutoff = otherCutoffs.Length == 0
                    ? null
                    : otherCutoffs
                        .GroupBy(v => v)
                        .OrderByDescending(gg => gg.Count())
                        .First().Key;
                // Collapse "65/65h" to a single value in the frontend
                // by nulling OtherCutoff when it matches Mon.
                if (monCutoff.HasValue && otherCutoff.HasValue && monCutoff.Value == otherCutoff.Value)
                    otherCutoff = null;

                var description = g.Select(x => x.Description).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x));

                // F1 delta model (2026-09-22): override count comes
                // straight off the header row, populated transactionally
                // by ScheduleOverrideService when a client's delta is
                // added / removed. The old "group headers by
                // BaseScheduleId" derivation was retired alongside the
                // clone-based CreateOverrideAsync flow.
                var overrideCount = header.OverrideCount;
                // Sum the per-day-row distinct-RouteId counts. A route
                // typically binds to one day-row per header, so this
                // matches the pre-refactor "distinct RouteIds across day
                // rows" in the common case. See note above the
                // dayRowToHeader definition for the trade-off.
                var routeCount = g.Sum(x => routeCountByDayRow.TryGetValue(x.BulkRunScheduleId, out var rc) ? rc : 0);

                // Linehaul hint: first active linehaul leg's run, in
                // Steve's "LH AUC-CHR 21:30" compact form. Depot codes
                // are the first 3 letters of the depot name, upper-
                // cased - matches the tenant's own convention where
                // depot names are already short single words.
                string linehaulHint = null;
                int? firstRunId = null;
                foreach (var x in g)
                {
                    if (linehaulByDayRow.TryGetValue(x.BulkRunScheduleId, out var r) && r.HasValue)
                    {
                        firstRunId = r.Value;
                        break;
                    }
                }
                if (firstRunId is int runId
                    && linehaulRuns.TryGetValue(runId, out var run))
                {
                    var fromCode = depotNames.TryGetValue(run.FromDepotId, out var fn) && fn?.Length >= 3
                        ? fn.Substring(0, 3).ToUpperInvariant() : $"#{run.FromDepotId}";
                    var toCode = depotNames.TryGetValue(run.ToDepotId, out var tn) && tn?.Length >= 3
                        ? tn.Substring(0, 3).ToUpperInvariant() : $"#{run.ToDepotId}";
                    var time = run.StartTime?.ToString(@"HH\:mm") ?? "--:--";
                    linehaulHint = $"LH {fromCode}-{toCode} {time}";
                }
                var clientCount = linkClientsByHeaderId.TryGetValue(header.ScheduleId, out var ids) ? ids.Count : 0;
                var postcodeCount = postcodeCountByName.TryGetValue(header.Name, out var pc) ? pc : 0;
                var polygonCount = polygonCountByName.TryGetValue(header.Name, out var poc) ? poc : 0;

                // F3 (2026-09-23): derived server-side from the delta
                // table. The list-view badge renders e.g.
                // "differs on: schedule, delivery" - aggregated across
                // every client's delta on this schedule, showing which
                // scopes have any override at all. Per-client detail is
                // still on ScheduleDetailModal's Client Overrides tab.
                string[] overriddenFields = overrideScopesByScheduleId
                    .TryGetValue(header.ScheduleId, out var scopes)
                    ? scopes
                    : Array.Empty<string>();

                var legacyCode = header.LegacyClientId.HasValue
                    && legacyClientCodes.TryGetValue(header.LegacyClientId.Value, out var code)
                    ? code : null;
                // Top 3 currently-linked client codes for the row chip strip
                // (sorted alphabetically for stable display). Full count is
                // clientCount; if it exceeds 3 the row renders "+N more".
                var linkedClientCodes = ids == null
                    ? Array.Empty<string>()
                    : ids.Select(cid => clientCodes.TryGetValue(cid, out var cc) ? cc : $"#{cid}")
                         .OrderBy(cc => cc, StringComparer.OrdinalIgnoreCase)
                         .Take(3)
                         .ToArray();
                return new ScheduleGroupSummaryDto(
                    header.ScheduleId,
                    header.Name,
                    header.LegacyClientId,
                    legacyCode,
                    first.Region ?? 0,
                    first.Region.HasValue && depotNames.TryGetValue(first.Region.Value, out var rn) ? rn : null,
                    first.SpeedId,
                    first.SpeedId.HasValue && speedNames.TryGetValue(first.SpeedId.Value, out var sn) ? sn : null,
                    activeDays,
                    activeZones,
                    clientCount, postcodeCount, polygonCount,
                    first.AutoBook, hasLh,
                    linkedClientCodes,
                    header.BaseScheduleId,
                    description,
                    pickupDepotId,
                    pickupDepotName,
                    windowStart,
                    windowEnd,
                    monCutoff,
                    otherCutoff,
                    overrideCount,
                    routeCount,
                    linehaulHint,
                    overriddenFields,
                    header.DisplayName,
                    header.DisplayDescription,
                    header.IsActive);
            });

        // "All live headers" mode. Used by /api/v2/schedules (Steve's
        // 2026-09-08 id-keyed view) which surfaces defaults + shared +
        // per-client together and does its own `type=` narrowing at the
        // controller. Skip both client-scope and default-only filters.
        if (includeAllLive)
        {
            return summaries.OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase).ToList();
        }

        // Apply UNION resolution rule when filtering by clientId: a client
        // sees every header it has a link row for, plus every live default
        // header. Matches the SP predicate in 20260908120001..003.
        if (clientId.HasValue)
        {
            var target = clientId.Value;
            var linkedHeaderIds = linkRows.Where(r => r.ClientId == target)
                .Select(r => r.ScheduleId)
                .ToHashSet();
            summaries = summaries.Where(s =>
                linkedHeaderIds.Contains(s.ScheduleId)
                || headersById[s.ScheduleId].IsDefault);
        }
        else if (includeClientSpecific)
        {
            // Flag semantic flipped 2026-09-08 (revised): "true" now means
            // "show client-specific ONLY" (per-client headers where
            // LegacyClientId IS NOT NULL), not "widen to defaults + per-
            // client". Operator mental model: ticking the box switches to
            // the client-specific browse; the frontend label reads
            // "Client-specific only". Defaults are the base view.
            summaries = summaries.Where(s => !headersById[s.ScheduleId].IsDefault);
        }
        else
        {
            // Default browse view: only IsDefault headers.
            summaries = summaries.Where(s => headersById[s.ScheduleId].IsDefault);
        }

        return summaries.OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>
    /// Read-only list of schedule bundles (Dane's Schedule Bundles).
    /// Aggregates member schedule count + total unique clients bound
    /// across the members' link rows. Only surfaces active bundles
    /// (IsActive = 1). Sorted alphabetically by name for a stable
    /// browse experience.
    ///
    /// Ships empty until the 20260914140000 migration applies (the
    /// tblBulkRunScheduleBundle + tblBulkRunScheduleBundleMember tables
    /// don't exist pre-migration). EF Core handles the empty DbSet
    /// gracefully; no code branch needed.
    /// </summary>
    public async Task<List<ScheduleBundleDto>> ListScheduleBundlesAsync()
    {
        // OrderBy with a StringComparer cannot translate to SQL - EF Core
        // throws `The LINQ expression ... could not be translated`. Fetch
        // the rows first, then sort with the case-insensitive ordinal
        // comparer client-side. Matches the pattern already used at the
        // end of ListSummaryAsync (line ~229) and by every other .OrderBy
        // (StringComparer) call in this service.
        var bundles = (await Context.BulkRunScheduleBundles.AsNoTracking()
            .Where(b => b.IsActive)
            .ToListAsync())
            .OrderBy(b => b.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (bundles.Count == 0) return new List<ScheduleBundleDto>();

        var bundleIds = bundles.Select(b => b.BundleId).ToList();
        var memberRows = await Context.BulkRunScheduleBundleMembers.AsNoTracking()
            .Where(m => bundleIds.Contains(m.BundleId))
            .ToListAsync();
        var scheduleIds = memberRows.Select(m => m.ScheduleId).Distinct().ToList();

        var headers = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => scheduleIds.Contains(h.ScheduleId) && h.RetiredUtc == null)
            .ToListAsync();
        var headersById = headers.ToDictionary(h => h.ScheduleId);

        // Client count = union of link rows across every non-default
        // member. Default headers do not carry link rows so they add
        // zero to the client count, matching Steve's brief section 2
        // Schedule Bundles tab semantics ("Attach clients to bundle -
        // one link row per client per member; members that are
        // defaults are skipped").
        var nonDefaultMemberIds = headers
            .Where(h => !h.IsDefault)
            .Select(h => h.ScheduleId)
            .ToHashSet();
        var linkRows = nonDefaultMemberIds.Count == 0
            ? new List<(int ScheduleId, int ClientId)>()
            : (await Context.ScheduleClients.AsNoTracking()
                .Where(sc => nonDefaultMemberIds.Contains(sc.ScheduleId))
                .Select(sc => new { sc.ScheduleId, sc.ClientId })
                .ToListAsync())
                .Select(x => (x.ScheduleId, x.ClientId))
                .ToList();
        var membersByBundle = memberRows.GroupBy(m => m.BundleId)
            .ToDictionary(g => g.Key, g => g.Select(m => m.ScheduleId).ToArray());

        return bundles.Select(b =>
        {
            var members = membersByBundle.TryGetValue(b.BundleId, out var ms) ? ms : Array.Empty<int>();
            var liveMembers = members.Where(id => headersById.ContainsKey(id)).ToArray();
            var uniqueClients = liveMembers
                .Where(id => nonDefaultMemberIds.Contains(id))
                .SelectMany(id => linkRows.Where(l => l.ScheduleId == id).Select(l => l.ClientId))
                .Distinct()
                .Count();
            var names = liveMembers
                .Select(id => headersById.TryGetValue(id, out var h) ? h.Name : $"#{id}")
                .ToArray();
            return new ScheduleBundleDto(
                b.BundleId, b.Name, b.Description, b.IsActive,
                liveMembers.Length, uniqueClients, liveMembers, names);
        }).ToList();
    }

    /// <summary>Full detail for one group by ScheduleId (preferred).</summary>
    public async Task<ScheduleGroupDto> GetDetailAsync(int scheduleId)
    {
        var header = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .FirstOrDefaultAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null);
        if (header == null)
            throw new InvalidOperationException($"Schedule id {scheduleId} not found or retired.");
        return await GetDetailByHeaderAsync(header);
    }

    /// <summary>Legacy (Name, LegacyClientId) overload. Resolves via header
    /// and delegates; preserved for one release so existing consumers do
    /// not break. Routes through ResolveHeaderByTupleAsync so ambiguous
    /// names hard-fail instead of silently returning the first match.</summary>
    public async Task<ScheduleGroupDto> GetDetailAsync(string name, int? legacyClientId)
    {
        var header = await ResolveHeaderByTupleAsync(name, legacyClientId, asNoTracking: true);
        return await GetDetailByHeaderAsync(header);
    }

    private async Task<ScheduleGroupDto> GetDetailByHeaderAsync(BulkRunScheduleHeader header)
    {
        var depotNames = await Context.TblBulkRegions.AsNoTracking()
            .ToDictionaryAsync(r => r.BulkRegionId, r => r.Name);
        var speedNames = await Context.TucJobTypes.AsNoTracking()
            .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);
        var groupNames = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .ToDictionaryAsync(g => g.Id, g => g.Name);
        var dropOffNames = await Context.TblDropOffLocations.AsNoTracking()
            .ToDictionaryAsync(d => d.DropOffLocationId, d => d.Name);

        var junctionClientIds = await Context.ScheduleClients.AsNoTracking()
            .Where(x => x.ScheduleId == header.ScheduleId)
            .Select(x => x.ClientId)
            .ToListAsync();
        var neededClientIds = junctionClientIds.ToHashSet();
        if (header.LegacyClientId.HasValue) neededClientIds.Add(header.LegacyClientId.Value);
        var clientLookup = neededClientIds.Count == 0
            ? new List<TucClientNameCode>()
            : await Context.TucClients.AsNoTracking()
                .Where(c => neededClientIds.Contains(c.UcclId))
                .Select(c => new TucClientNameCode { Id = c.UcclId, Code = c.UcclCode, Name = c.UcclName })
                .ToListAsync();
        var clientCodes = clientLookup
            .Where(c => c.Code != null)
            .ToDictionary(c => c.Id, c => c.Code);
        var clientNames = clientLookup
            .Where(c => !string.IsNullOrWhiteSpace(c.Name))
            .ToDictionary(c => c.Id, c => c.Name);

        var clientJunctions = await Context.ScheduleClients.AsNoTracking()
            .Where(x => x.ScheduleId == header.ScheduleId)
            .ToListAsync();
        var postcodeJunctions = await Context.SchedulePostcodes.AsNoTracking()
            .Where(x => x.ScheduleName == header.Name)
            .ToListAsync();
        var polygonJunctions = await Context.SchedulePolygons.AsNoTracking()
            .Where(x => x.ScheduleName == header.Name)
            .ToListAsync();

        var rows = await Context.TblBulkRunSchedules.AsNoTracking()
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .Where(s => s.ScheduleId == header.ScheduleId)
            .OrderBy(s => s.DayOfWeek)
            .ToListAsync();
        if (rows.Count == 0)
            throw new InvalidOperationException($"Schedule group '{header.Name}' has no day rows.");

        return MapGroup(header, rows, clientJunctions, postcodeJunctions, polygonJunctions,
            depotNames, speedNames, groupNames, dropOffNames, clientCodes, clientNames);
    }

    /// <summary>
    /// Per-client "what can this client book" resolver per Steve's brief §5
    /// SQL. Returns one row per live header the client can actually book,
    /// tagged with why:
    ///   - "override": the client owns this override header (BaseScheduleId != null + link row).
    ///   - "shared":   the client is linked to a shared header (BaseScheduleId == null + link row).
    ///   - "default":  the client has no link row for any override of a
    ///                  default header, so the default falls through.
    /// The "default" branch is suppressed when the client already owns an
    /// override of that specific base (§5 SQL NOT EXISTS clause) so the
    /// operator only sees one entry per bookable base.
    /// </summary>
    public async Task<List<ClientScheduleDto>> GetSchedulesForClientAsync(int clientId)
    {
        var headers = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => h.RetiredUtc == null)
            .Select(h => new { h.ScheduleId, h.Name, h.IsDefault, h.BaseScheduleId })
            .ToListAsync();

        var linkedIds = await Context.ScheduleClients.AsNoTracking()
            .Where(sc => sc.ClientId == clientId)
            .Select(sc => sc.ScheduleId)
            .ToListAsync();
        var linkedSet = new HashSet<int>(linkedIds);

        // Overrides: headers with a link row AND BaseScheduleId set.
        var results = new List<ClientScheduleDto>();
        var suppressBaseIds = new HashSet<int>();
        foreach (var h in headers.Where(h => linkedSet.Contains(h.ScheduleId) && h.BaseScheduleId.HasValue))
        {
            results.Add(new ClientScheduleDto(h.ScheduleId, h.Name, "override"));
            suppressBaseIds.Add(h.BaseScheduleId!.Value);
        }
        // Shared: link row + no BaseScheduleId.
        foreach (var h in headers.Where(h => linkedSet.Contains(h.ScheduleId) && !h.BaseScheduleId.HasValue))
        {
            results.Add(new ClientScheduleDto(h.ScheduleId, h.Name, "shared"));
        }
        // Default: IsDefault + not already covered by an override the client owns.
        foreach (var h in headers.Where(h => h.IsDefault && !linkedSet.Contains(h.ScheduleId) && !suppressBaseIds.Contains(h.ScheduleId)))
        {
            results.Add(new ClientScheduleDto(h.ScheduleId, h.Name, "default"));
        }
        return results
            .OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// List schedule groups (full detail). If clientId is provided, applies
    /// the strict resolution rule; otherwise returns only default headers
    /// with no link rows.
    /// </summary>
    public async Task<List<ScheduleGroupDto>> GetAsync(int? clientId)
    {
        var depotNames = await Context.TblBulkRegions.AsNoTracking()
            .ToDictionaryAsync(r => r.BulkRegionId, r => r.Name);
        var speedNames = await Context.TucJobTypes.AsNoTracking()
            .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);
        var groupNames = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .ToDictionaryAsync(g => g.Id, g => g.Name);
        var dropOffNames = await Context.TblDropOffLocations.AsNoTracking()
            .ToDictionaryAsync(d => d.DropOffLocationId, d => d.Name);
        var clientLookupAll = await Context.TucClients.AsNoTracking()
            .Where(c => c.UcclCode != null || c.UcclName != null)
            .Select(c => new TucClientNameCode { Id = c.UcclId, Code = c.UcclCode, Name = c.UcclName })
            .Take(50000)
            .ToListAsync();
        var clientCodes = clientLookupAll
            .Where(c => c.Code != null)
            .ToDictionary(c => c.Id, c => c.Code);
        var clientNames = clientLookupAll
            .Where(c => !string.IsNullOrWhiteSpace(c.Name))
            .ToDictionary(c => c.Id, c => c.Name);

        var headers = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => h.RetiredUtc == null)
            .ToListAsync();
        var headersById = headers.ToDictionary(h => h.ScheduleId);
        var liveHeaderIds = new HashSet<int>(headers.Select(h => h.ScheduleId));

        var clientJunctions = await Context.ScheduleClients.AsNoTracking()
            .Where(sc => liveHeaderIds.Contains(sc.ScheduleId))
            .ToListAsync();
        var postcodeJunctions = await Context.SchedulePostcodes.AsNoTracking().ToListAsync();
        var polygonJunctions = await Context.SchedulePolygons.AsNoTracking().ToListAsync();

        var rows = await Context.TblBulkRunSchedules.AsNoTracking()
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .Where(s => liveHeaderIds.Contains(s.ScheduleId))
            .OrderBy(s => s.Name)
            .ThenBy(s => s.DayOfWeek)
            .ToListAsync();

        var groups = rows
            .GroupBy(r => r.ScheduleId)
            .Where(g => headersById.ContainsKey(g.Key))
            .Select(g =>
            {
                var header = headersById[g.Key];
                var scoped = clientJunctions.Where(cj => cj.ScheduleId == header.ScheduleId).ToList();
                return MapGroup(header, g.ToList(), scoped, postcodeJunctions, polygonJunctions,
                    depotNames, speedNames, groupNames, dropOffNames, clientCodes, clientNames);
            })
            .ToList();

        if (clientId.HasValue)
        {
            var target = clientId.Value;
            var linkedHeaderIds = clientJunctions.Where(sc => sc.ClientId == target)
                .Select(sc => sc.ScheduleId)
                .ToHashSet();
            // UNION rule: linked headers OR every live default.
            groups = groups
                .Where(g => linkedHeaderIds.Contains(g.ScheduleId)
                    || headersById[g.ScheduleId].IsDefault)
                .ToList();
        }
        else
        {
            // See ListSummaryAsync note: post-AddScheduleHeaderAndIdKeyedLinks
            // every default header carries link rows (default-safety-net), so
            // the old "ClientIds.Count == 0" additional filter empties the
            // browse. Filter on IsDefault alone.
            groups = groups
                .Where(g => headersById[g.ScheduleId].IsDefault)
                .ToList();
        }

        return groups;
    }

    public async Task<List<ScheduleGroupSummaryDto>> ListSummaryByClientCodeAsync(string clientCode)
    {
        if (string.IsNullOrWhiteSpace(clientCode))
            return await ListSummaryAsync(clientId: null);
        var trimmed = clientCode.Trim();
        var id = await Context.TucClients.AsNoTracking()
            .Where(c => c.UcclCode == trimmed)
            .Select(c => (int?)c.UcclId)
            .FirstOrDefaultAsync();
        if (id == null)
            throw new InvalidOperationException($"Client code '{trimmed}' not found.");
        return await ListSummaryAsync(id);
    }

    public async Task<List<ScheduleGroupDto>> GetByClientCodeAsync(string clientCode)
    {
        if (string.IsNullOrWhiteSpace(clientCode))
            return await GetAsync(clientId: null);
        var trimmed = clientCode.Trim();
        var id = await Context.TucClients.AsNoTracking()
            .Where(c => c.UcclCode == trimmed)
            .Select(c => (int?)c.UcclId)
            .FirstOrDefaultAsync();
        if (id == null)
            throw new InvalidOperationException($"Client code '{trimmed}' not found.");
        return await GetAsync(id);
    }

    public async Task<List<LookupItemDto>> SearchClientsAsync(string q, int limit = 50)
    {
        var query = Context.TucClients.AsNoTracking()
            .Where(c => c.UcclActive == true);

        if (!string.IsNullOrWhiteSpace(q))
        {
            var needle = q.Trim();
            var pattern = $"%{needle}%";
            query = query.Where(c =>
                EF.Functions.Like(c.UcclCode, pattern)
                || EF.Functions.Like(c.UcclName, pattern));
        }

        return await query
            .OrderBy(c => c.UcclCode)
            .Take(Math.Clamp(limit, 1, 200))
            .Select(c => new LookupItemDto(c.UcclId, (c.UcclCode ?? "") + " " + (c.UcclName ?? "")))
            .ToListAsync();
    }

    public async Task<ScheduleLookupsDto> GetLookupsAsync()
    {
        var depots = await Context.TblBulkRegions.AsNoTracking()
            .Where(r => r.Active ?? true)
            .OrderBy(r => r.Name)
            .Select(r => new LookupItemDto(r.BulkRegionId, r.Name))
            .ToListAsync();

        var speeds = await Context.TucJobTypes.AsNoTracking()
            .OrderBy(t => t.UcjtName)
            .Select(t => new LookupItemDto(t.UcjtId, t.UcjtName))
            .ToListAsync();

        var couriers = await Context.TucCouriers.AsNoTracking()
            .Where(c => c.Active)
            .OrderBy(c => c.Code)
            .Select(c => new LookupItemDto(c.UccrId, (c.Code ?? "") + " " + (c.UccrName ?? "")))
            .ToListAsync();

        var clients = await Context.TucClients.AsNoTracking()
            .Where(c => c.UcclActive == true)
            .OrderBy(c => c.UcclCode)
            .Take(500)
            .Select(c => new LookupItemDto(c.UcclId, (c.UcclCode ?? "") + " " + (c.UcclName ?? "")))
            .ToListAsync();

        var dropOffs = await Context.TblDropOffLocations.AsNoTracking()
            .OrderBy(d => d.Name)
            .Select(d => new DropOffLocationDto(d.DropOffLocationId, d.Name, d.DepotId))
            .ToListAsync();

        var postcodeGroups = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .OrderBy(g => g.Name)
            .Select(g => new PostcodeGroupLookupDto(g.Id, g.Name, g.DepotId, g.ClientId))
            .ToListAsync();

        var runRows = await Context.TblbulkLinehaulRuns.AsNoTracking()
            .OrderBy(r => r.RunName)
            .Select(r => new
            {
                r.Id, r.RunName, r.FromDepotId, r.ToDepotId,
                r.StartTime, r.DespatchTime, r.CourierId,
            })
            .ToListAsync();
        var linehaulRuns = runRows.Select(r => new LinehaulRunDto(
                r.Id, r.RunName, r.FromDepotId, r.ToDepotId,
                r.StartTime?.ToString("HH:mm"), r.DespatchTime?.ToString("HH:mm"),
                r.CourierId))
            .ToList();

        var zoneNumbers = await Context.BulkZonePostcodes.AsNoTracking()
            .Select(p => p.Zone)
            .Union(Context.BulkZoneSchedules.AsNoTracking().Select(z => z.Zone))
            .Distinct()
            .OrderBy(z => z)
            .ToListAsync();

        // Labels for the legacy int enum. Source of truth:
        // C:\Gitlab\ClientManager_Root\ClientManager\wwwroot\app\components\schedules\schedulesControl.js:5-7
        // Ids match the persisted values in tblBulkRunSchedule.StorageState / .DeliveryState /
        // .PickupBoxDiscount. Do NOT invent labels here; align to ClientManager.
        var storageStates = new List<StateOptionDto>
        {
            new(0, "None"), new(1, "Ambient"), new(2, "Chilled"), new(3, "Frozen"),
        };
        // Labels for the legacy int enum. Source of truth:
        // C:\Gitlab\ClientManager_Root\ClientManager\wwwroot\app\components\schedules\schedulesControl.js:5-7
        // Ids match the persisted values in tblBulkRunSchedule.StorageState / .DeliveryState /
        // .PickupBoxDiscount. Do NOT invent labels here; align to ClientManager.
        var deliveryStates = new List<StateOptionDto>
        {
            new(0, "None"), new(1, "Ambient"), new(2, "Chilled"), new(3, "Frozen"),
        };
        // Labels for the legacy int enum. Source of truth:
        // C:\Gitlab\ClientManager_Root\ClientManager\wwwroot\app\components\schedules\schedulesControl.js:5-7
        // Ids match the persisted values in tblBulkRunSchedule.StorageState / .DeliveryState /
        // .PickupBoxDiscount. Do NOT invent labels here; align to ClientManager.
        var pickupBoxDiscounts = new List<StateOptionDto>
        {
            new(0, "Charge once only"), new(1, "Additional box discount"), new(2, "Charge per box"),
        };

        return new ScheduleLookupsDto(
            depots, speeds, couriers, clients, dropOffs, postcodeGroups, linehaulRuns,
            zoneNumbers, storageStates, deliveryStates, pickupBoxDiscounts);
    }

    // ─── WRITES ────────────────────────────────────────────────────────────

    /// <summary>
    /// Upsert a schedule group. If `req.ScheduleId` is set the existing
    /// header is updated (rename applies to header + syncs day rows); if
    /// unset a fresh default header (IsDefault=1, LegacyClientId=null)
    /// is created together with day rows + junction rows.
    /// </summary>
    public async Task<ScheduleGroupDto> UpsertAsync(ScheduleGroupUpsertRequest req)
    {
        ValidateUpsert(req);
        var linehaulError = ValidateLinehauls(req.Linehauls);
        if (linehaulError != null) throw new InvalidOperationException(linehaulError);

        var name = req.Name.Trim();

        BulkRunScheduleHeader header;
        List<TblBulkRunSchedule> existing;
        // F13 (Steve 2026-09-20): normalise empty/whitespace-only display
        // strings from the form to NULL on write so the backend can tell
        // "operator cleared it" (NULL, fall back to Name) apart from
        // "operator never touched it" (also NULL). The frontend also sends
        // NULL explicitly on clear, but this is a defensive server-side
        // fold in case a raw empty string leaks through.
        var displayName = string.IsNullOrWhiteSpace(req.DisplayName) ? null : req.DisplayName.Trim();
        var displayDescription = string.IsNullOrWhiteSpace(req.DisplayDescription) ? null : req.DisplayDescription.Trim();
        // F21: bool? Unset = true (pre-F21 callers keep their behaviour
        // where every schedule is bookable). Frontend always sends the
        // explicit boolean once the field ships.
        var isActive = req.IsActive ?? true;
        if (req.ScheduleId.HasValue && req.ScheduleId.Value > 0)
        {
            header = await Context.BulkRunScheduleHeaders
                .FirstOrDefaultAsync(h => h.ScheduleId == req.ScheduleId.Value && h.RetiredUtc == null)
                ?? throw new InvalidOperationException($"Schedule id {req.ScheduleId.Value} not found or retired.");
            if (!string.Equals(header.Name, name, StringComparison.Ordinal))
                header.Name = name;
            header.DisplayName = displayName;
            header.DisplayDescription = displayDescription;
            header.IsActive = isActive;
            existing = await Context.TblBulkRunSchedules
                .Include(s => s.BulkZoneSchedules)
                .Include(s => s.TblBulkScheduleLinehauls)
                .Where(s => s.ScheduleId == header.ScheduleId)
                .ToListAsync();
        }
        else
        {
            // Fresh default header + day rows.
            header = new BulkRunScheduleHeader
            {
                Name = name,
                IsDefault = true,
                LegacyClientId = null,
                CreatedUtc = DateTime.UtcNow,
                CreatedBy = "RoutedOps",
                DisplayName = displayName,
                DisplayDescription = displayDescription,
                IsActive = isActive,
            };
            Context.BulkRunScheduleHeaders.Add(header);
            existing = new List<TblBulkRunSchedule>();
        }

        // Sync day-window rows.
        var incomingIds = new HashSet<int>(req.DayWindows.Where(w => w.Id.HasValue).Select(w => w.Id!.Value));
        foreach (var row in existing.ToList())
        {
            var matched = req.DayWindows.FirstOrDefault(w =>
                (w.Id.HasValue && w.Id.Value == row.BulkRunScheduleId) ||
                (!w.Id.HasValue && w.DayOfWeek == row.DayOfWeek));
            if (matched == null)
            {
                Context.BulkZoneSchedules.RemoveRange(row.BulkZoneSchedules);
                Context.TblBulkScheduleLinehauls.RemoveRange(row.TblBulkScheduleLinehauls);
                Context.TblBulkRunSchedules.Remove(row);
                existing.Remove(row);
            }
        }

        foreach (var w in req.DayWindows)
        {
            var row = w.Id.HasValue
                ? existing.FirstOrDefault(r => r.BulkRunScheduleId == w.Id.Value)
                : existing.FirstOrDefault(r => r.DayOfWeek == w.DayOfWeek);
            if (row == null)
            {
                row = new TblBulkRunSchedule
                {
                    Name = name,
                    // Legacy ClientId column on the day row: keep writing it
                    // per brief §5 so anything still reading it (Client
                    // Manager ScheduleService.GetByClient, booking
                    // ScheduleService.GetRecurringScheduleIds, legacy SPs)
                    // keeps working on newly-created rows. Stops once
                    // nothing reads it. Steve's 2026-09-09 regression
                    // review Finding 6.
                    ClientId = header.LegacyClientId,
                    // F8 preservation: 10000 is the default for freshly-inserted
                    // day rows only. MaxJobs is deliberately NOT on
                    // ScheduleGroupUpsertRequest and ApplyGroupTemplateToRow
                    // does NOT touch it, so existing rows keep whatever
                    // MaxJobs the operator set through the day-level UI.
                    // Do not add MaxJobs to the request DTO or the template
                    // without gating "req.MaxJobs > 0 ? req.MaxJobs : row.MaxJobs"
                    // on the existing-row branch, or you will clobber real
                    // operator values on save (Steve 2026-09-20 F8).
                    MaxJobs = 10000,
                    Header = header, // EF wires ScheduleId on save
                };
                Context.TblBulkRunSchedules.Add(row);
                existing.Add(row);
            }
            else if (!string.Equals(row.Name, name, StringComparison.Ordinal))
            {
                // Header rename cascades to day rows so the legacy Name
                // column stays in sync with the header's canonical value.
                row.Name = name;
            }
            ApplyGroupTemplateToRow(row, req);
            row.DayOfWeek = w.DayOfWeek;
            row.StartTime = ParseTime(w.StartTime);
            row.EndTime = ParseTime(w.EndTime);
            row.CutoffHours = w.CutoffHours;
        }

        // Zones + linehauls apply to every row in the group.
        //
        // F7 preservation (Steve 2026-09-20): only remove-and-re-add when the
        // caller declared explicit intent by sending a non-null collection.
        // A null Zones / Linehauls on the request means "leave alone" and we
        // must NOT touch the existing rows. Sending an empty array [] IS
        // explicit intent to clear. Prior behaviour treated null and []
        // the same and wiped live zone / linehaul rows on any save that
        // did not repopulate them (e.g. the operator edits a non-zone field
        // and the frontend omits Zones from the payload).
        foreach (var row in existing)
        {
            if (req.Zones != null)
            {
                Context.BulkZoneSchedules.RemoveRange(row.BulkZoneSchedules);
                foreach (var z in req.Zones)
                    row.BulkZoneSchedules.Add(new BulkZoneSchedule { Zone = z.Zone, Active = z.Active });
            }
            if (req.Linehauls != null)
            {
                Context.TblBulkScheduleLinehauls.RemoveRange(row.TblBulkScheduleLinehauls);
                foreach (var l in req.Linehauls)
                    row.TblBulkScheduleLinehauls.Add(MapLinehaulToEntity(l));
            }
        }

        // Resolve the desired client-link set. clientCodes is authoritative
        // when provided (operator UI toggles chips by code, not by id, so
        // clientCodes reflects exactly the set the operator wants after
        // any add/remove). clientIds is only used as a fallback for API
        // callers that don't have code strings handy.
        //
        // Bug fixed 2026-09-09: the previous shape started resolvedClientIds
        // from req.ClientIds and then MERGED clientCodes on top - because
        // the frontend chip toggle only updates clientCodes (not
        // clientIds), a chip removal left the id in req.ClientIds and the
        // merge kept the client bound. Result: removing a chip + Save
        // returned 200 but the link row survived. Fix: when clientCodes
        // is non-null (present in the request body, even if empty) it
        // fully defines the set. Bad code still throws before any writes.
        List<int> resolvedClientIds;
        if (req.ClientCodes != null)
        {
            resolvedClientIds = new List<int>();
            foreach (var code in req.ClientCodes.Where(c => !string.IsNullOrWhiteSpace(c)))
            {
                var id = await Context.TucClients.AsNoTracking()
                    .Where(c => c.UcclCode == code.Trim())
                    .Select(c => (int?)c.UcclId)
                    .FirstOrDefaultAsync();
                if (id == null) throw new InvalidOperationException($"Client code '{code}' not found.");
                if (!resolvedClientIds.Contains(id.Value)) resolvedClientIds.Add(id.Value);
            }
        }
        else
        {
            resolvedClientIds = new List<int>(req.ClientIds ?? new());
        }

        await SyncClientsAsync(header, resolvedClientIds);
        await SyncPostcodesAsync(header.Name, req.PostcodeIds);
        await SyncPolygonsAsync(header.Name, req.PolygonIds);

        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();

        return await GetDetailByHeaderAsync(header);
    }

    /// <summary>Retire the header (soft delete). Day rows + link rows survive
    /// so history + downstream references stay intact. Preferred entry
    /// point.</summary>
    public async Task DeleteAsync(int scheduleId)
    {
        var header = await Context.BulkRunScheduleHeaders
            .FirstOrDefaultAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null)
            ?? throw new InvalidOperationException($"Schedule id {scheduleId} not found or already retired.");
        header.RetiredUtc = DateTime.UtcNow;
        header.RetiredBy = "RoutedOps";
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
    }

    /// <summary>Legacy (Name, LegacyClientId) overload. Resolves via header
    /// and delegates. Hard-fails on ambiguity (production has 164 names
    /// mapping to multiple definitions per Steve's brief) so a fallback
    /// call cannot silently retire the wrong schedule. Steve's
    /// 2026-09-09 regression review Finding 3.</summary>
    public async Task DeleteAsync(string name, int? legacyClientId)
    {
        var header = await ResolveHeaderByTupleAsync(name, legacyClientId);
        header.RetiredUtc = DateTime.UtcNow;
        header.RetiredBy = "RoutedOps";
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
    }

    /// <summary>
    /// Copy a schedule group by ScheduleId (preferred). Creates a fresh
    /// header + clones day rows + copies postcode/polygon junctions + sets
    /// the target client link set.
    /// </summary>
    public async Task<ScheduleGroupDto> CopyAsync(ScheduleCopyRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.NewName))
            throw new InvalidOperationException("New name is required.");
        var newName = req.NewName.Trim();

        // Resolve source header (prefer id, fall back to tuple).
        BulkRunScheduleHeader source;
        if (req.SourceScheduleId.HasValue && req.SourceScheduleId.Value > 0)
        {
            source = await Context.BulkRunScheduleHeaders.AsNoTracking()
                .FirstOrDefaultAsync(h => h.ScheduleId == req.SourceScheduleId.Value && h.RetiredUtc == null)
                ?? throw new InvalidOperationException($"Source schedule id {req.SourceScheduleId.Value} not found.");
        }
        else
        {
            // Legacy tuple fallback - hard-fail on ambiguity per Steve's
            // 2026-09-09 regression review Finding 3.
            source = await ResolveHeaderByTupleAsync(req.SourceName, req.SourceLegacyClientId, asNoTracking: true);
        }

        if (string.Equals(source.Name, newName, StringComparison.OrdinalIgnoreCase)
            && source.LegacyClientId == null)
            throw new InvalidOperationException("New name must differ from the source name for a default copy.");

        var targetExists = await Context.BulkRunScheduleHeaders
            .AnyAsync(h => h.Name == newName && h.IsDefault && h.LegacyClientId == null && h.RetiredUtc == null);
        if (targetExists)
            throw new InvalidOperationException($"A schedule named '{newName}' already exists. Pick a different name.");

        var sourceRows = await Context.TblBulkRunSchedules.AsNoTracking()
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .Where(s => s.ScheduleId == source.ScheduleId)
            .ToListAsync();
        if (sourceRows.Count == 0)
            throw new InvalidOperationException("Source schedule has no day rows.");

        // Resolve target client ids before writes so a bad code throws early.
        List<int> targetClientIds;
        if (req.ClientCodes != null && req.ClientCodes.Count > 0)
        {
            targetClientIds = new List<int>();
            foreach (var code in req.ClientCodes.Where(c => !string.IsNullOrWhiteSpace(c)))
            {
                var id = await Context.TucClients.AsNoTracking()
                    .Where(c => c.UcclCode == code.Trim())
                    .Select(c => (int?)c.UcclId)
                    .FirstOrDefaultAsync();
                if (id == null) throw new InvalidOperationException($"Client code '{code}' not found.");
                targetClientIds.Add(id.Value);
            }
        }
        else if (req.ClientIds != null && req.ClientIds.Count > 0)
        {
            targetClientIds = req.ClientIds.Distinct().ToList();
        }
        else
        {
            // Inherit source header's junction clients.
            targetClientIds = await Context.ScheduleClients.AsNoTracking()
                .Where(x => x.ScheduleId == source.ScheduleId)
                .Select(x => x.ClientId)
                .ToListAsync();
        }

        var srcPostcodes = await Context.SchedulePostcodes.AsNoTracking()
            .Where(x => x.ScheduleName == source.Name)
            .Select(x => x.PostCode)
            .ToListAsync();
        var srcPolygons = await Context.SchedulePolygons.AsNoTracking()
            .Where(x => x.ScheduleName == source.Name)
            .Select(x => x.PolygonId)
            .ToListAsync();

        // New header + day-row clones + junction rows in one atomic save.
        var newHeader = new BulkRunScheduleHeader
        {
            Name = newName,
            IsDefault = true,
            LegacyClientId = null,
            CreatedUtc = DateTime.UtcNow,
            CreatedBy = "RoutedOps",
        };
        Context.BulkRunScheduleHeaders.Add(newHeader);

        foreach (var src in sourceRows)
        {
            var clone = new TblBulkRunSchedule
            {
                Name = newName,
                // Legacy ClientId column on day row - see UpsertAsync for
                // full rationale. New copy is always a default header
                // (LegacyClientId is null), so day-row ClientId stays
                // null too - matches the legacy convention where
                // default-schedule day rows carry ClientId IS NULL.
                ClientId = newHeader.LegacyClientId,
                Header = newHeader, // EF wires ScheduleId on save
                DayOfWeek = src.DayOfWeek,
                StartTime = src.StartTime,
                EndTime = src.EndTime,
                CutoffHours = src.CutoffHours,
                MaxJobs = src.MaxJobs > 0 ? src.MaxJobs : 10000,
                Region = src.Region,
                SpeedId = src.SpeedId,
                ParentSpeedId = src.ParentSpeedId,
                AutoBook = src.AutoBook,
                BookPickup = src.BookPickup,
                ApplyPickupCutoff = src.ApplyPickupCutoff,
                PickupCutoff = src.PickupCutoff,
                PostcodeGroupId = src.PostcodeGroupId,
                PickupPostcodeGroupId = src.PickupPostcodeGroupId,
                PickupDepotId = src.PickupDepotId,
                PickupRatingSpeed = src.PickupRatingSpeed,
                StorageState = src.StorageState,
                DeliveryState = src.DeliveryState,
                PickupBoxDiscount = src.PickupBoxDiscount,
                DropOffLocationId = src.DropOffLocationId,
                Description = src.Description,
            };
            foreach (var z in src.BulkZoneSchedules)
                clone.BulkZoneSchedules.Add(new BulkZoneSchedule { Zone = z.Zone, Active = z.Active });
            foreach (var l in src.TblBulkScheduleLinehauls)
                clone.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
                {
                    Name = l.Name, Active = l.Active,
                    Amount = l.Amount, AmountPercentage = l.AmountPercentage,
                    FromDepotId = l.FromDepotId, ToDepotId = l.ToDepotId,
                    InsertToBulk = l.InsertToBulk, Minutes = l.Minutes,
                    LinehaulRunId = l.LinehaulRunId,
                    ApplyDiscount = l.ApplyDiscount, ApplyAddOnPercentage = l.ApplyAddOnPercentage,
                    WeekDay = l.WeekDay, DepartureAdvanceDays = l.DepartureAdvanceDays,
                    FromClientAddress = l.FromClientAddress, DropOffLocationId = l.DropOffLocationId,
                });
            Context.TblBulkRunSchedules.Add(clone);
        }

        await SyncClientsAsync(newHeader, targetClientIds);
        await SyncPostcodesAsync(newName, srcPostcodes);
        await SyncPolygonsAsync(newName, srcPolygons);

        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();

        return await GetDetailByHeaderAsync(newHeader);
    }

    /// <summary>Toggle AutoBook across every row in the group.</summary>
    public async Task<bool> ToggleAutoBookAsync(int scheduleId)
    {
        var header = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .FirstOrDefaultAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null)
            ?? throw new InvalidOperationException("Schedule not found.");
        var rows = await Context.TblBulkRunSchedules
            .Where(s => s.ScheduleId == header.ScheduleId)
            .ToListAsync();
        if (rows.Count == 0) throw new InvalidOperationException("Schedule has no day rows.");
        var newValue = !(rows[0].AutoBook ?? false);
        foreach (var r in rows) r.AutoBook = newValue;
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
        return newValue;
    }

    /// <summary>Legacy (Name, LegacyClientId) overload. Hard-fails on
    /// ambiguity per Steve's 2026-09-09 regression review Finding 3.</summary>
    public async Task<bool> ToggleAutoBookAsync(string name, int? legacyClientId)
    {
        var header = await ResolveHeaderByTupleAsync(name, legacyClientId, asNoTracking: true);
        return await ToggleAutoBookAsync(header.ScheduleId);
    }

    /// <summary>Set the header-level IsActive flag (Steve F21 2026-09-22).
    /// Independent of AutoBook: IsActive gates whether the schedule can be
    /// booked at all; AutoBook gates book-immediately vs stage. Writes the
    /// new value verbatim (not a toggle) so the caller controls the
    /// desired state; mirrors the row-column shape the SchedulesTable
    /// switch renders.</summary>
    public async Task<bool> ToggleIsActiveAsync(int scheduleId, bool isActive)
    {
        var header = await Context.BulkRunScheduleHeaders
            .FirstOrDefaultAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null)
            ?? throw new InvalidOperationException("Schedule not found.");
        var previous = header.IsActive;
        header.IsActive = isActive;
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
        _logger.LogInformation(
            "ToggleIsActive: scheduleId={ScheduleId} {Previous} -> {Next}",
            scheduleId, previous, isActive);
        return isActive;
    }

    // ─── HELPERS ───────────────────────────────────────────────────────────

    /// <summary>
    /// Resolve a header by the legacy (Name, LegacyClientId) tuple. Hard-
    /// fails on ambiguity - production has 164 schedule names that map to
    /// multiple headers (per Steve's 2026-09-08 brief §2 measurements), so
    /// a fallback call cannot silently pick one. Steve's 2026-09-09
    /// regression review Finding 3.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// Name is blank, no header matches, or multiple live headers share
    /// the (Name, LegacyClientId) tuple.
    /// </exception>
    private async Task<BulkRunScheduleHeader> ResolveHeaderByTupleAsync(
        string name, int? legacyClientId, bool asNoTracking = false)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Schedule name is required.");
        var trimmed = name.Trim();
        var query = asNoTracking
            ? Context.BulkRunScheduleHeaders.AsNoTracking()
            : Context.BulkRunScheduleHeaders.AsQueryable();
        var candidates = await query
            .Where(h => h.Name == trimmed
                     && h.LegacyClientId == legacyClientId
                     && h.RetiredUtc == null)
            .Take(2)
            .ToListAsync();
        if (candidates.Count == 0)
            throw new InvalidOperationException(
                $"Schedule not found: name='{trimmed}', legacyClientId={legacyClientId?.ToString() ?? "null"}.");
        if (candidates.Count > 1)
            throw new InvalidOperationException(
                $"Schedule tuple is ambiguous: name='{trimmed}', legacyClientId={legacyClientId?.ToString() ?? "null"} " +
                "matches more than one live header. Pass scheduleId (from ScheduleGroup.scheduleId) instead.");
        _logger.LogWarning(
            "Legacy schedule tuple resolved: name='{Name}' legacyClientId={LegacyClientId} -> scheduleId={ScheduleId}. Callers should pass scheduleId directly; this fallback is scheduled for removal next release.",
            trimmed, legacyClientId, candidates[0].ScheduleId);
        return candidates[0];
    }

    private async Task SyncClientsAsync(BulkRunScheduleHeader header, IEnumerable<int> desired)
    {
        // When the header is brand-new (id == 0), we cannot query
        // existing rows by id yet - the id is populated by SaveChanges.
        // In that case skip the delete pass and just add all desired ids.
        List<ScheduleClient> current;
        if (header.ScheduleId == 0)
        {
            current = new List<ScheduleClient>();
        }
        else
        {
            current = await Context.ScheduleClients
                .Where(x => x.ScheduleId == header.ScheduleId)
                .ToListAsync();
        }
        var desiredSet = new HashSet<int>(desired ?? Enumerable.Empty<int>());
        Context.ScheduleClients.RemoveRange(current.Where(x => !desiredSet.Contains(x.ClientId)));
        var currentIds = new HashSet<int>(current.Select(x => x.ClientId));
        foreach (var id in desiredSet.Where(id => !currentIds.Contains(id)))
        {
            Context.ScheduleClients.Add(new ScheduleClient
            {
                Header = header, // EF wires ScheduleId on save
                ClientId = id,
                CreatedUtc = DateTime.UtcNow,
                CreatedBy = "RoutedOps",
            });
        }
    }

    private async Task SyncPostcodesAsync(string name, IEnumerable<int> desired)
    {
        var current = await Context.SchedulePostcodes
            .Where(x => x.ScheduleName == name)
            .ToListAsync();
        var desiredSet = new HashSet<int>(desired ?? Enumerable.Empty<int>());
        Context.SchedulePostcodes.RemoveRange(current.Where(x => !desiredSet.Contains(x.PostCode)));
        var currentSet = new HashSet<int>(current.Select(x => x.PostCode));
        foreach (var p in desiredSet.Where(p => !currentSet.Contains(p)))
        {
            Context.SchedulePostcodes.Add(new SchedulePostcode
            {
                ScheduleName = name, PostCode = p, CreatedUtc = DateTime.UtcNow,
            });
        }
    }

    private async Task SyncPolygonsAsync(string name, IEnumerable<int> desired)
    {
        var current = await Context.SchedulePolygons
            .Where(x => x.ScheduleName == name)
            .ToListAsync();
        var desiredSet = new HashSet<int>(desired ?? Enumerable.Empty<int>());
        Context.SchedulePolygons.RemoveRange(current.Where(x => !desiredSet.Contains(x.PolygonId)));
        var currentSet = new HashSet<int>(current.Select(x => x.PolygonId));
        foreach (var pid in desiredSet.Where(pid => !currentSet.Contains(pid)))
        {
            Context.SchedulePolygons.Add(new SchedulePolygon
            {
                ScheduleName = name, PolygonId = pid, CreatedUtc = DateTime.UtcNow,
            });
        }
    }

    private static void ApplyGroupTemplateToRow(TblBulkRunSchedule row, ScheduleGroupUpsertRequest req)
    {
        row.Region = req.RegionId;
        row.PickupDepotId = req.PickupDepotId;
        row.SpeedId = req.SpeedId;
        row.ParentSpeedId = req.ParentSpeedId;
        row.AutoBook = req.AutoBook;
        row.BookPickup = req.BookPickup;
        row.ApplyPickupCutoff = req.ApplyPickupCutoff;
        row.PickupCutoff = req.PickupCutoff;
        row.PostcodeGroupId = req.PostcodeGroupId;
        row.PickupPostcodeGroupId = req.PickupPostcodeGroupId;
        row.PickupRatingSpeed = req.PickupRatingSpeed;
        row.StorageState = req.StorageState;
        row.DeliveryState = req.DeliveryState;
        row.PickupBoxDiscount = req.PickupBoxDiscount;
        row.DropOffLocationId = req.DropOffLocationId;
        row.Description = req.Description;
    }

    private static ScheduleGroupDto MapGroup(
        BulkRunScheduleHeader header,
        List<TblBulkRunSchedule> rows,
        List<ScheduleClient> clientJunctions,
        List<SchedulePostcode> postcodeJunctions,
        List<SchedulePolygon> polygonJunctions,
        Dictionary<int, string> depotNames,
        Dictionary<int, string> speedNames,
        Dictionary<int, string> groupNames,
        Dictionary<int, string> dropOffNames,
        Dictionary<int, string> clientCodes,
        Dictionary<int, string> clientNames)
    {
        string LookupClientCode(int id) =>
            clientCodes.TryGetValue(id, out var c) && !string.IsNullOrWhiteSpace(c) ? c : $"#{id}";
        string LookupClientName(int id) =>
            clientNames.TryGetValue(id, out var n) && !string.IsNullOrWhiteSpace(n) ? n : null;
        var t = rows[0];
        string LookupDepot(int? id) => id.HasValue && depotNames.TryGetValue(id.Value, out var n) ? n : null;
        string LookupSpeed(int? id) => id.HasValue && speedNames.TryGetValue(id.Value, out var n) ? n : null;
        string LookupGroup(int? id) => id.HasValue && groupNames.TryGetValue(id.Value, out var n) ? n : null;
        string LookupDropOff(int? id) => id.HasValue && dropOffNames.TryGetValue(id.Value, out var n) ? n : null;

        var linksForHeader = clientJunctions
            .Where(x => x.ScheduleId == header.ScheduleId)
            .OrderBy(x => x.ClientId)
            .ToList();
        var clientIds = linksForHeader.Select(x => x.ClientId).ToList();
        var clientCodesForGroup = clientIds.Select(LookupClientCode).ToList();
        var clientNamesForGroup = clientIds.Select(LookupClientName).ToList();
        var clientLinkedUtcs = linksForHeader
            .Select(x => (DateTime?)x.CreatedUtc)
            .ToList();
        var legacyClientCode = header.LegacyClientId.HasValue ? LookupClientCode(header.LegacyClientId.Value) : null;
        var postcodeIds = postcodeJunctions
            .Where(x => x.ScheduleName == header.Name)
            .Select(x => x.PostCode)
            .OrderBy(x => x)
            .ToList();
        var polygonIds = polygonJunctions
            .Where(x => x.ScheduleName == header.Name)
            .Select(x => x.PolygonId)
            .OrderBy(x => x)
            .ToList();

        var dayWindows = rows
            .OrderBy(r => r.DayOfWeek)
            .Select(r => new DayWindowDto(
                r.BulkRunScheduleId,
                r.DayOfWeek ?? 0,
                FormatTime(r.StartTime),
                FormatTime(r.EndTime),
                r.CutoffHours))
            .ToList();

        var zones = t.BulkZoneSchedules
            .OrderBy(z => z.Zone)
            .Select(z => new ScheduleZoneDto(z.Id, z.ScheduleId, z.Zone, z.Active))
            .ToList();
        var linehauls = t.TblBulkScheduleLinehauls
            .OrderBy(l => l.Name)
            .Select(l => new ScheduleLinehaulDto(
                l.Id, l.Name, l.Active, l.Amount, l.AmountPercentage,
                l.FromDepotId, l.ToDepotId, l.Minutes, l.LinehaulRunId,
                l.InsertToBulk, l.ApplyDiscount, l.ApplyAddOnPercentage,
                ParseWeekday(l.WeekDay), l.DepartureAdvanceDays,
                l.FromClientAddress, l.DropOffLocationId,
                l.SpeedId, LookupSpeed(l.SpeedId)))
            .ToList();

        return new ScheduleGroupDto(
            header.ScheduleId,
            header.Name, header.LegacyClientId, legacyClientCode,
            t.Region ?? 0, LookupDepot(t.Region),
            t.PickupDepotId, LookupDepot(t.PickupDepotId),
            t.SpeedId, LookupSpeed(t.SpeedId),
            t.ParentSpeedId, LookupSpeed(t.ParentSpeedId),
            t.PostcodeGroupId, LookupGroup(t.PostcodeGroupId),
            t.PickupPostcodeGroupId, LookupGroup(t.PickupPostcodeGroupId),
            t.PickupRatingSpeed,
            t.AutoBook, t.BookPickup,
            t.ApplyPickupCutoff, t.PickupCutoff,
            t.StorageState, t.DeliveryState, t.PickupBoxDiscount,
            t.DropOffLocationId, LookupDropOff(t.DropOffLocationId),
            t.Description,
            dayWindows, zones, linehauls,
            clientIds, clientCodesForGroup, postcodeIds, polygonIds,
            clientLinkedUtcs, clientNamesForGroup,
            header.DisplayName, header.DisplayDescription, header.IsActive);
    }

    private static string FormatTime(TimeSpan? t) =>
        t.HasValue ? t.Value.ToString(@"hh\:mm") : null;

    private static int[] ParseWeekday(string wd)
    {
        if (string.IsNullOrWhiteSpace(wd)) return new[] { 0, 0, 0, 0, 0, 0, 0 };
        var arr = new int[7];
        for (var i = 0; i < 7 && i < wd.Length; i++)
            arr[i] = wd[i] == '1' ? 1 : 0;
        return arr;
    }

    private static void ValidateUpsert(ScheduleGroupUpsertRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            throw new InvalidOperationException("Schedule name is required.");
        if (req.RegionId <= 0)
            throw new InvalidOperationException("Destination depot (Region) is required.");
        if (req.DayWindows == null || req.DayWindows.Count == 0)
            throw new InvalidOperationException("At least one day-window is required.");
        var seenDays = new HashSet<short>();
        foreach (var w in req.DayWindows)
        {
            if (w.DayOfWeek < 1 || w.DayOfWeek > 7)
                throw new InvalidOperationException($"DayOfWeek must be 1-7 (got {w.DayOfWeek}).");
            if (!seenDays.Add(w.DayOfWeek))
                throw new InvalidOperationException($"Duplicate day-window for day {w.DayOfWeek}.");
            if (string.IsNullOrWhiteSpace(w.StartTime) || string.IsNullOrWhiteSpace(w.EndTime))
                throw new InvalidOperationException($"Day {w.DayOfWeek}: start + end time required.");
        }
    }

    private static string ValidateLinehauls(IEnumerable<ScheduleLinehaulUpsertRequest> linehauls)
    {
        if (linehauls == null) return null;
        var index = 0;
        foreach (var l in linehauls)
        {
            index++;
            var label = string.IsNullOrWhiteSpace(l.Name) ? $"#{index}" : l.Name.Trim();
            if (string.IsNullOrWhiteSpace(l.Name))
                return $"Linehaul {label}: Name is required.";
            if (l.FromClientAddress != true && (!l.FromDepotId.HasValue || l.FromDepotId.Value <= 0))
                return $"Linehaul {label}: From Depot is required.";
            if (!l.ToDepotId.HasValue || l.ToDepotId.Value <= 0)
                return $"Linehaul {label}: To Depot is required.";
            if (l.WeekDay == null || !l.WeekDay.Any(d => d == 1))
                return $"Linehaul {label}: At least one active day is required.";
        }
        return null;
    }

    private static TblBulkScheduleLinehaul MapLinehaulToEntity(ScheduleLinehaulUpsertRequest l) =>
        new()
        {
            Name = l.Name,
            Active = l.Active,
            Amount = l.Amount ?? 0,
            AmountPercentage = l.AmountPercentage ?? 0,
            FromDepotId = l.FromDepotId ?? 0,
            ToDepotId = l.ToDepotId ?? 0,
            InsertToBulk = l.InsertToBulk,
            Minutes = l.Minutes,
            LinehaulRunId = l.LinehaulRunId,
            ApplyDiscount = l.ApplyDiscount,
            ApplyAddOnPercentage = l.ApplyAddOnPercentage,
            WeekDay = string.Join("", (l.WeekDay ?? new[] { 0, 0, 0, 0, 0, 0, 0 }).Select(d => d == 1 ? '1' : '0')),
            DepartureAdvanceDays = l.DepartureAdvanceDays,
            FromClientAddress = l.FromClientAddress,
            DropOffLocationId = l.DropOffLocationId,
            SpeedId = l.SpeedId,
        };

    private static TimeSpan ParseTime(string hhmm)
    {
        if (TimeSpan.TryParse(hhmm, out var ts)) return ts;
        throw new InvalidOperationException($"Invalid time format: '{hhmm}'. Use HH:mm.");
    }

    // ─── v2 write endpoints (Steve's 2026-09-08 KEVIN-NEW-SCHEDULES-VIEW ──
    // brief Phase 3). Kept dedicated (not routed through UpsertAsync) so
    // the audit trail on link rows carries the exact operator action -
    // "attach" vs "detach" vs "override create" is a different CreatedBy
    // string than "upsert-form-submit" and dispatchers rely on that
    // distinction when reconciling drift.

    /// <summary>
    /// Attach one or more clients to a schedule via the link table.
    /// Idempotent: already-attached client ids are silently skipped.
    /// Under the F1 delta model a client keeps its base link and adds
    /// a delta row when it needs an override; there is no exclusivity
    /// between base attach and override anymore.
    /// </summary>
    public async Task<int> AttachClientsAsync(int scheduleId, IEnumerable<int> clientIds)
    {
        var ids = (clientIds ?? Array.Empty<int>()).Where(v => v > 0).Distinct().ToList();
        if (ids.Count == 0) return 0;

        var header = await Context.BulkRunScheduleHeaders
            .FirstOrDefaultAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null)
            ?? throw new InvalidOperationException($"Schedule id {scheduleId} not found or retired.");

        // Defensive: verify every id resolves to a real client before we
        // attempt the insert. Without this, a stale UI picker sending a
        // deleted client id would surface as an FK violation - the
        // controller catches DbUpdateException but the error message
        // ("...conflicted with FOREIGN KEY constraint...") is opaque.
        var existingIds = await Context.TucClients.AsNoTracking()
            .Where(c => ids.Contains(c.UcclId))
            .Select(c => c.UcclId)
            .ToListAsync();
        var missing = ids.Except(existingIds).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException(
                $"Client id(s) {string.Join(", ", missing)} do not exist. Refresh and try again.");

        // Skip already-attached rows.
        var existing = await Context.ScheduleClients.AsNoTracking()
            .Where(sc => sc.ScheduleId == scheduleId && ids.Contains(sc.ClientId))
            .Select(sc => sc.ClientId)
            .ToListAsync();
        var already = new HashSet<int>(existing);

        var now = DateTime.UtcNow;
        var toAdd = ids
            .Where(id => !already.Contains(id))
            .Select(id => new ScheduleClient
            {
                ScheduleId = scheduleId,
                ClientId = id,
                CreatedUtc = now,
                CreatedBy = "RoutedOps:attach",
            })
            .ToList();
        if (toAdd.Count == 0) return 0;

        Context.ScheduleClients.AddRange(toAdd);
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
        return toAdd.Count;
    }

    /// <summary>
    /// Full replace of a schedule's link rows. Adds every id not already
    /// linked; removes every current link not in the new set. Under the
    /// F1 delta model there is no per-client exclusivity - a client can
    /// hold a base link and a delta row simultaneously.
    /// </summary>
    public async Task<(int Added, int Removed)> ReplaceClientsAsync(int scheduleId, IEnumerable<int> clientIds)
    {
        var desired = (clientIds ?? Array.Empty<int>()).Where(v => v > 0).Distinct().ToList();

        var header = await Context.BulkRunScheduleHeaders
            .FirstOrDefaultAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null)
            ?? throw new InvalidOperationException($"Schedule id {scheduleId} not found or retired.");

        if (desired.Count > 0)
        {
            var existingIds = await Context.TucClients.AsNoTracking()
                .Where(c => desired.Contains(c.UcclId))
                .Select(c => c.UcclId)
                .ToListAsync();
            var missing = desired.Except(existingIds).ToList();
            if (missing.Count > 0)
                throw new InvalidOperationException(
                    $"Client id(s) {string.Join(", ", missing)} do not exist. Refresh and try again.");
        }

        var current = await Context.ScheduleClients
            .Where(sc => sc.ScheduleId == scheduleId)
            .ToListAsync();
        var currentIds = new HashSet<int>(current.Select(sc => sc.ClientId));
        var desiredSet = new HashSet<int>(desired);

        var toRemove = current.Where(sc => !desiredSet.Contains(sc.ClientId)).ToList();
        if (toRemove.Count > 0) Context.ScheduleClients.RemoveRange(toRemove);

        var now = DateTime.UtcNow;
        var toAdd = desired
            .Where(id => !currentIds.Contains(id))
            .Select(id => new ScheduleClient
            {
                ScheduleId = scheduleId,
                ClientId = id,
                CreatedUtc = now,
                CreatedBy = "RoutedOps:replace",
            })
            .ToList();
        if (toAdd.Count > 0) Context.ScheduleClients.AddRange(toAdd);

        if (toAdd.Count > 0 || toRemove.Count > 0)
            await Context.SaveChangesAsync();
        InvalidateListSummaryCache();

        return (toAdd.Count, toRemove.Count);
    }

    /// <summary>
    /// Detach one client from a schedule. Idempotent - detaching a
    /// non-attached client is a no-op (returns 0).
    /// </summary>
    public async Task<int> DetachClientAsync(int scheduleId, int clientId)
    {
        var row = await Context.ScheduleClients
            .FirstOrDefaultAsync(sc => sc.ScheduleId == scheduleId && sc.ClientId == clientId);
        if (row == null) return 0;
        Context.ScheduleClients.Remove(row);
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
        return 1;
    }

    // ─── Schedule Bundles writes (Phase 4 per Steve's brief; Kevin
    // asked for these on 2026-09-15 to complete Phase 1 shipping) ──

    /// <summary>
    /// Create a new Schedule Bundle with an initial member list.
    /// Members are validated to exist as live headers. Bundles are
    /// active by default; description is optional.
    /// </summary>
    public async Task<int> CreateBundleAsync(string name, string description, IEnumerable<int> scheduleIds)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Bundle name is required.");
        var trimmedName = name.Trim();
        if (await Context.BulkRunScheduleBundles.AsNoTracking().AnyAsync(b => b.Name == trimmedName))
            throw new InvalidOperationException($"A bundle named '{trimmedName}' already exists.");

        var memberIds = (scheduleIds ?? Array.Empty<int>()).Where(v => v > 0).Distinct().ToList();
        if (memberIds.Count > 0)
        {
            var liveIds = await Context.BulkRunScheduleHeaders.AsNoTracking()
                .Where(h => memberIds.Contains(h.ScheduleId) && h.RetiredUtc == null)
                .Select(h => h.ScheduleId)
                .ToListAsync();
            var missing = memberIds.Except(liveIds).ToList();
            if (missing.Count > 0)
                throw new InvalidOperationException($"Schedule ids not found or retired: {string.Join(", ", missing)}.");
        }

        var bundle = new BulkRunScheduleBundle
        {
            Name = trimmedName,
            Description = description?.Trim() ?? string.Empty,
            IsActive = true,
            CreatedUtc = DateTime.UtcNow,
            CreatedBy = "RoutedOps:bundle-create",
        };
        Context.BulkRunScheduleBundles.Add(bundle);
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();

        foreach (var id in memberIds)
        {
            Context.BulkRunScheduleBundleMembers.Add(new BulkRunScheduleBundleMember
            {
                BundleId = bundle.BundleId,
                ScheduleId = id,
            });
        }
        if (memberIds.Count > 0) { await Context.SaveChangesAsync(); InvalidateListSummaryCache(); }

        return bundle.BundleId;
    }

    /// <summary>
    /// Hard-delete a Schedule Bundle + all its members (FK is CASCADE
    /// per migration 20260914140000). Does NOT touch the underlying
    /// schedules or their link rows - only the bundle metadata.
    /// </summary>
    public async Task DeleteBundleAsync(int bundleId)
    {
        var bundle = await Context.BulkRunScheduleBundles
            .FirstOrDefaultAsync(b => b.BundleId == bundleId)
            ?? throw new InvalidOperationException($"Bundle {bundleId} not found.");
        Context.BulkRunScheduleBundles.Remove(bundle);
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
    }

    /// <summary>Rename / redescribe a Schedule Bundle.</summary>
    public async Task UpdateBundleAsync(int bundleId, string name, string description)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Bundle name is required.");
        var trimmedName = name.Trim();
        var bundle = await Context.BulkRunScheduleBundles
            .FirstOrDefaultAsync(b => b.BundleId == bundleId)
            ?? throw new InvalidOperationException($"Bundle {bundleId} not found.");
        if (bundle.Name != trimmedName
            && await Context.BulkRunScheduleBundles.AsNoTracking()
                .AnyAsync(b => b.Name == trimmedName && b.BundleId != bundleId))
            throw new InvalidOperationException($"A bundle named '{trimmedName}' already exists.");
        bundle.Name = trimmedName;
        bundle.Description = description?.Trim() ?? string.Empty;
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
    }

    /// <summary>Add member schedules to a bundle. Idempotent.</summary>
    public async Task<int> AddBundleMembersAsync(int bundleId, IEnumerable<int> scheduleIds)
    {
        var ids = (scheduleIds ?? Array.Empty<int>()).Where(v => v > 0).Distinct().ToList();
        if (ids.Count == 0) return 0;
        _ = await Context.BulkRunScheduleBundles.AsNoTracking()
            .FirstOrDefaultAsync(b => b.BundleId == bundleId)
            ?? throw new InvalidOperationException($"Bundle {bundleId} not found.");

        var liveIds = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => ids.Contains(h.ScheduleId) && h.RetiredUtc == null)
            .Select(h => h.ScheduleId)
            .ToListAsync();
        var missing = ids.Except(liveIds).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException($"Schedule ids not found or retired: {string.Join(", ", missing)}.");

        var existing = await Context.BulkRunScheduleBundleMembers.AsNoTracking()
            .Where(m => m.BundleId == bundleId && ids.Contains(m.ScheduleId))
            .Select(m => m.ScheduleId)
            .ToListAsync();
        var already = new HashSet<int>(existing);

        var toAdd = ids.Where(id => !already.Contains(id))
            .Select(id => new BulkRunScheduleBundleMember { BundleId = bundleId, ScheduleId = id })
            .ToList();
        if (toAdd.Count == 0) return 0;
        Context.BulkRunScheduleBundleMembers.AddRange(toAdd);
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
        return toAdd.Count;
    }

    /// <summary>Remove a schedule from a bundle.</summary>
    public async Task<int> RemoveBundleMemberAsync(int bundleId, int scheduleId)
    {
        var row = await Context.BulkRunScheduleBundleMembers
            .FirstOrDefaultAsync(m => m.BundleId == bundleId && m.ScheduleId == scheduleId);
        if (row == null) return 0;
        Context.BulkRunScheduleBundleMembers.Remove(row);
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
        return 1;
    }

    /// <summary>
    /// Attach one or more clients to every non-default member schedule
    /// of a bundle. Default members (IsDefault = 1) are skipped per
    /// Steve's brief section 2 semantics: the link table is the sole
    /// record of who uses what, and defaults do not need per-client
    /// rows. Returns the total number of link rows added.
    /// </summary>
    public async Task<int> AttachClientsToBundleAsync(int bundleId, IEnumerable<int> clientIds)
    {
        var ids = (clientIds ?? Array.Empty<int>()).Where(v => v > 0).Distinct().ToList();
        if (ids.Count == 0) return 0;

        var memberScheduleIds = await Context.BulkRunScheduleBundleMembers.AsNoTracking()
            .Where(m => m.BundleId == bundleId)
            .Select(m => m.ScheduleId)
            .ToListAsync();
        if (memberScheduleIds.Count == 0)
            throw new InvalidOperationException($"Bundle {bundleId} has no members.");

        var nonDefaultMembers = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => memberScheduleIds.Contains(h.ScheduleId)
                     && h.RetiredUtc == null
                     && !h.IsDefault)
            .Select(h => h.ScheduleId)
            .ToListAsync();

        if (nonDefaultMembers.Count == 0) return 0;

        // Skip pairs that already exist to keep the operation idempotent.
        var existing = await Context.ScheduleClients.AsNoTracking()
            .Where(sc => nonDefaultMembers.Contains(sc.ScheduleId) && ids.Contains(sc.ClientId))
            .Select(sc => new { sc.ScheduleId, sc.ClientId })
            .ToListAsync();
        var existingSet = new HashSet<(int, int)>(existing.Select(x => (x.ScheduleId, x.ClientId)));

        var now = DateTime.UtcNow;
        var toAdd = new List<ScheduleClient>();
        foreach (var sid in nonDefaultMembers)
        {
            foreach (var cid in ids)
            {
                if (existingSet.Contains((sid, cid))) continue;
                toAdd.Add(new ScheduleClient
                {
                    ScheduleId = sid,
                    ClientId = cid,
                    CreatedUtc = now,
                    CreatedBy = $"RoutedOps:bundle-attach:{bundleId}",
                });
            }
        }

        if (toAdd.Count > 0)
        {
            Context.ScheduleClients.AddRange(toAdd);
            await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
        }
        return toAdd.Count;
    }

    private sealed class TucClientNameCode
    {
        public int Id { get; set; }
        public string Code { get; set; }
        public string Name { get; set; }
    }
}
