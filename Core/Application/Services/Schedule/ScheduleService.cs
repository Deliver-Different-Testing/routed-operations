using System.Diagnostics;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
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
/// Postcode junction keys on ScheduleId (re-key, 2026-10-16); the polygon
/// junction was retired. Writes still carry ScheduleName until the step-3
/// migration drops it, because it is half of the database key.
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
    TenantScopedCache cache,
    IScheduleConverter converter,
    IHttpContextAccessor httpContextAccessor)
    : BaseService(contextFactory)
{
    /// <summary>
    /// Which tenant this caller is on, read from the CountryCode claim the
    /// Hub cookie carries. Literal "US" is the US path and anything else,
    /// including a missing claim, is NZ, matching TerritoryService and
    /// ZoneLookupService rather than inventing a third rule.
    ///
    /// Note the claim is the only source worth reading: tblSetting.CountryCode
    /// is NULL on both US tenants (measured 27 Oct), so a database-side test
    /// would answer NZ for them.
    /// </summary>
    private bool IsUsTenant() =>
        string.Equals(
            httpContextAccessor.HttpContext?.User.FindFirstValue("CountryCode"),
            "US",
            StringComparison.OrdinalIgnoreCase);

    private readonly ILogger<ScheduleService> _logger = logger;

    // Collapses a saved schedule onto its detail row. See IScheduleConverter
    // for why the derivation stays in the stored procedure.
    private readonly IScheduleConverter _converter = converter;

    // Cache key + TTL for ListSummaryAsync (all-live browse path only).
    // 30s matches the frontend's React Query staleTime so a rapid
    // tab-switch or refetch cycle (invalidate + re-render) serves from
    // memory instead of re-hitting the DB. Every write path calls
    // InvalidateListSummaryCache below so operator mutations still
    // surface immediately. Per-client and legacy-flag entry points are
    // NOT cached: they hit different code paths and are only called by
    // niche legacy views; safer to leave them uncached than to grow the
    // invalidation surface.
    /// <summary>Upper bound on the occurrences field, matching the CHECK on
    /// both columns. 14 originally (decision D2 of the occurrences spec),
    /// raised to 60 on 2026-10-14 by 20261014090000: 14 was arbitrary and
    /// clamping at it cost 21 client and schedule pairs dates they are
    /// offered today, the largest wanting 53.
    ///
    /// Note this counts OCCURRENCES while OccurrencePreviewHorizonDays
    /// counts DAYS, and they are not the same 60. A schedule running once a
    /// week asked for 60 will preview about 8, because the horizon runs out
    /// first. That is correct and visible rather than silent: the preview
    /// shows what the booking page would actually offer.</summary>
    private const int MaxOccurrencesAhead = 60;

    /// <summary>How far the preview looks forward. Same 60 days the
    /// availability functions use, so a schedule the booking page cannot
    /// fill inside the horizon previews as short here too rather than
    /// quietly reaching further.</summary>
    private const int OccurrencePreviewHorizonDays = 60;

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

    /// <summary>
    /// Patch ONE schedule's row into the cached all-live list instead of
    /// dropping the whole entry, and fall back to dropping it if there is
    /// nothing to patch.
    ///
    /// Why, measured on the office-local copy 2026-10-20. Invalidating makes
    /// the next reader rebuild from scratch, and a save is the worst possible
    /// moment to ask for that: the writer's own locks are still settling, so
    /// all four wave-2 queries block on them. One save produced a 19.9s list
    /// load (link=19722 rows=18923 ovrScope=19168 ovrFull=16625) against a
    /// 0.3 to 3.2s steady state, and every concurrent reader waited on the
    /// same single-flight gate. Recomputing one schedule touches the same
    /// code path but with liveHeaderIds narrowed to a single id, so wave 2
    /// reads a handful of rows rather than 7,748.
    ///
    /// This keeps the property the invalidation was there for: the operator
    /// still sees their own write on the very next read, because the row is
    /// recomputed rather than left stale. Ordering is preserved because the
    /// list's contract is Name ascending, OrdinalIgnoreCase.
    ///
    /// An empty result means the header is no longer in the all-live set, so
    /// the row is dropped rather than re-added. Any failure falls through to
    /// the old behaviour, which is correct but slow, never wrong.
    /// </summary>
    private async Task RefreshListSummaryEntryAsync(int scheduleId)
    {
        try
        {
            var patched = await cache.TryPatchAsync<List<ScheduleGroupSummaryDto>>(
                AllLiveListCacheKey,
                ListSummaryCacheTtl,
                async current =>
                {
                    var fresh = await ListSummaryUncachedAsync(
                        clientId: null,
                        includeClientSpecific: false,
                        includeAllLive: true,
                        onlyScheduleIds: new[] { scheduleId });

                    var next = current.Where(s => s.ScheduleId != scheduleId).ToList();
                    next.AddRange(fresh);
                    return next
                        .OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
                        .ToList();
                },
                sliding: false);

            if (!patched) InvalidateListSummaryCache();
        }
        catch (Exception ex)
        {
            // Never let a cache optimisation fail a save that already
            // committed. Dropping the key is always safe.
            _logger.LogWarning(ex,
                "List summary patch failed for schedule {ScheduleId}; invalidating instead.",
                scheduleId);
            InvalidateListSummaryCache();
        }
    }

    // ─── READS ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Slim list-view projection used by the Schedules tab. Server-side
    /// aggregates on the junction / zone / linehaul tables so the initial
    /// page load stays sub-500ms even on tenants with 2k+ schedules.
    ///
    /// `includeClientSpecific`:
    ///   - false (default): only headers with IsDefault = 1. The flag
    ///     alone, NOT "has no link rows": since spec 6.1 a default may
    ///     have clients configured on it and is still a default. Fastest.
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

    /// <param name="onlyScheduleIds">
    /// Restricts the computation to these headers. Null means every live
    /// header, which is the browse path. Passing a single id is what the
    /// post-save cache patch uses (see RefreshListSummaryEntryAsync): every
    /// wave-2 query already filters on liveHeaderIds, which is derived from
    /// the header set, so narrowing the headers narrows the whole second wave
    /// without touching any of those queries. Wave 1 is left unscoped on
    /// purpose; it is nine small lookups totalling well under 100ms and
    /// several of them have no schedule to filter by.
    /// </param>
    private async Task<List<ScheduleGroupSummaryDto>> ListSummaryUncachedAsync(
        int? clientId, bool includeClientSpecific, bool includeAllLive,
        IReadOnlyCollection<int> onlyScheduleIds = null)
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
            var q = ctx.BulkRunScheduleHeaders.AsNoTracking()
                .Where(h => h.RetiredUtc == null);
            // The one narrowing that matters: everything in wave 2 keys off
            // the header set, so scoping here scopes the expensive half.
            if (onlyScheduleIds != null)
                q = q.Where(h => onlyScheduleIds.Contains(h.ScheduleId));
            return await q.ToListAsync();
        });
        var postcodeCountsTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.SchedulePostcodes.AsNoTracking()
                .Where(x => x.ScheduleId != null)
                .GroupBy(x => x.ScheduleId.Value)
                .Select(g => new { ScheduleId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.ScheduleId, x => x.Count);
        });
        var polygonCountsTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            // Derived from zone membership now that tblSchedulePolygon is
            // retired (custom-polygons spec 3.4). A polygon counts towards a
            // schedule when it is a member of a zone that schedule fulfils,
            // in that schedule's delivery or pickup zone group.
            var pairs = await (
                from row in ctx.TblBulkRunSchedules.AsNoTracking()
                join h in ctx.BulkRunScheduleHeaders.AsNoTracking()
                    on row.ScheduleId equals h.ScheduleId
                join z in ctx.BulkZoneSchedules.AsNoTracking()
                    on row.BulkRunScheduleId equals z.ScheduleId
                join zp in ctx.BulkZonePolygons.AsNoTracking()
                    on new { G = row.PostcodeGroupId ?? 0, z.Zone }
                    equals new { G = zp.PostcodeGroupId, zp.Zone }
                where h.RetiredUtc == null && z.Active == true && zp.Active
                select new { h.Name, zp.PolygonId })
                .Distinct().ToListAsync();
            return pairs
                .GroupBy(x => x.Name)
                .ToDictionary(g => g.Key, g => g.Select(x => x.PolygonId).Distinct().Count());
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
        var (postcodeCountById, w1PostcodeMs) = postcodeCountsTask.Result;
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
                    s.CutoffDay,
                    s.CutoffTime,
                    s.PickupRatingSpeed,
                    s.PostcodeGroupId,
                    s.PickupPostcodeGroupId,
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
        // 2026-09-24: full override rows for the nested-override rendering
        // in the Schedules NEW list. One row per (Schedule, Client, Scope);
        // consumers group by (Schedule, Client) and diff each column
        // against the base to produce the "Cut-off Fri 13:00 (base Fri
        // 15:00)" delta labels shown as xs muted text under the nested
        // <tr>. Bounded by the number of overriding clients across the
        // tenant, which stays in the low thousands even on the busiest
        // tenants (most schedules have zero overrides).
        var overrideFullRowsTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.BulkRunScheduleOverrides.AsNoTracking()
                .Where(o => liveHeaderIds.Contains(o.ScheduleId))
                .ToListAsync();
        });
        // Lookup for zone-group names, needed for the "Pickup zone group
        // X (base Y)" delta labels. Small table (dozens per tenant) so a
        // full-table fetch is cheaper than a scoped query.
        var postcodeGroupNamesTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.BulkZonePostcodeGroups.AsNoTracking()
                .ToDictionaryAsync(g => g.Id, g => g.Name);
        });
        // Which schedules have collapsed, and their occurrences-ahead. One
        // row per converted schedule, so this table is at most as big as the
        // header table and usually far smaller. Joined into wave 2 rather
        // than queried on its own so it costs no extra round trip.
        var detailsTask = Timed(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.BulkRunScheduleDetails.AsNoTracking()
                .Where(d => liveHeaderIds.Contains(d.ScheduleId))
                .ToDictionaryAsync(d => d.ScheduleId);
        });
        await Task.WhenAll(linkRowsTask, rowBasesTask, overrideScopeRowsTask,
            overrideFullRowsTask, postcodeGroupNamesTask, detailsTask);
        var (detailsByScheduleId, w2DetailMs) = detailsTask.Result;
        var (linkRows, w2LinkMs) = linkRowsTask.Result;
        var (rowBases, w2RowsMs) = rowBasesTask.Result;
        var (overrideScopeRows, w2OverrideScopeMs) = overrideScopeRowsTask.Result;
        var (overrideFullRows, w2OverrideFullMs) = overrideFullRowsTask.Result;
        var (postcodeGroupNames, w2PostcodeGroupMs) = postcodeGroupNamesTask.Result;

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

        // ─── Wave 3: merged client codes + names (single TucClients trip).
        var legacyClientIds = headers
            .Where(h => h.LegacyClientId.HasValue)
            .Select(h => h.LegacyClientId!.Value)
            .Distinct()
            .ToList();
        var overrideClientIds = overrideFullRows
            .Select(o => o.ClientId)
            .Distinct()
            .ToList();
        var allClientIdsForCodes = linkClientsByHeaderId.Values
            .SelectMany(s => s)
            .Concat(legacyClientIds)
            .Concat(overrideClientIds)
            .Distinct()
            .ToList();

        var clientLookupTask = Timed(async () =>
        {
            if (allClientIdsForCodes.Count == 0)
                return new List<TucClientNameCode>();
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TucClients.AsNoTracking()
                .Where(c => allClientIdsForCodes.Contains(c.UcclId))
                .Select(c => new TucClientNameCode { Id = c.UcclId, Code = c.UcclCode, Name = c.UcclName })
                .ToListAsync();
        });
        var (clientLookup, w3ClientMs) = await clientLookupTask;
        var clientCodes = clientLookup
            .Where(c => c.Code != null)
            .ToDictionary(c => c.Id, c => c.Code);
        var clientNames = clientLookup
            .Where(c => c.Name != null)
            .ToDictionary(c => c.Id, c => c.Name);
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
            "w2[link={W2LinkMs} rows={W2RowsMs} ovrScope={W2OvrScopeMs} " +
            "ovrFull={W2OvrFullMs} pcGroup={W2PcGroupMs}]ms | " +
            "w3[client={W3ClientMs}]ms | " +
            "headers={HeaderCount} dayRows={DayRowCount}",
            totalSw.ElapsedMilliseconds,
            w1DepotMs, w1SpeedMs, w1HeadersMs, w1PostcodeMs, w1PolygonMs,
            w1ZoneMs, w1LinehaulMs, w1RouteMs, w1RunsMs,
            w2LinkMs, w2RowsMs, w2OverrideScopeMs, w2OverrideFullMs,
            w2PostcodeGroupMs, w3ClientMs,
            headers.Count, rowBases.Count);

        // 2026-09-24: group override rows by ScheduleId so each header can
        // enumerate its per-client deltas without a nested Where per summary.
        var overrideRowsByScheduleId = overrideFullRows
            .GroupBy(o => o.ScheduleId)
            .ToDictionary(g => g.Key, g => g.ToList());

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
                var postcodeCount = postcodeCountById.TryGetValue(header.ScheduleId, out var pc) ? pc : 0;
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
                // 2026-09-24: nested override rows. One per (Schedule,
                // Client) pair; the DeltaLabels array carries the human-
                // readable list of scope+field differences. Rendered by
                // the frontend as nested <tr> under this base row.
                var overridesForSchedule = overrideRowsByScheduleId.TryGetValue(header.ScheduleId, out var ovrRows)
                    ? BuildOverrideRows(
                        ovrRows,
                        header,
                        new OverrideBaseSnapshot(
                            first.CutoffDay,
                            first.CutoffTime,
                            first.StartTime,
                            first.EndTime,
                            first.PickupDepotId,
                            first.PickupRatingSpeed,
                            first.PickupPostcodeGroupId,
                            first.SpeedId,
                            first.PostcodeGroupId),
                        activeDays,
                        clientCodes, clientNames, speedNames, postcodeGroupNames, depotNames)
                    : new List<ScheduleOverrideRowDto>();
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
                    header.IsActive,
                    overridesForSchedule,
                    detailsByScheduleId.TryGetValue(header.ScheduleId, out var det),
                    det?.OccurrencesAhead,
                    header.OriginType ?? "depot",
                    header.IsDefault);
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
        // member, per Steve's brief section 2 Schedule Bundles tab semantics
        // ("Attach clients to bundle - one link row per client per member;
        // members that are defaults are skipped").
        //
        // The skip is deliberate, not an optimisation on an empty set: since
        // spec 6.1 a default CAN carry link rows, and those clients are
        // configured on it rather than restricted to it, so counting them
        // would overstate how many clients the bundle restricts to.
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
            .Where(x => x.ScheduleId == header.ScheduleId)
            .ToListAsync();
        var polygonJunctions = await GetZoneDerivedPolygonsAsync(new List<int> { header.ScheduleId });

        var rows = await Context.TblBulkRunSchedules.AsNoTracking()
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.BulkPickupZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .Where(s => s.ScheduleId == header.ScheduleId)
            .OrderBy(s => s.DayOfWeek)
            .ToListAsync();
        if (rows.Count == 0)
            throw new InvalidOperationException($"Schedule group '{header.Name}' has no day rows.");

        var clientsWithoutGeocode = await GetClientsWithoutGeocodeAsync(
            clientJunctions.Select(x => x.ClientId));
        var detail = await Context.BulkRunScheduleDetails.AsNoTracking()
            .FirstOrDefaultAsync(d => d.ScheduleId == header.ScheduleId);
        return MapGroup(header, rows, detail, _lastConvert is { CanConvert: false } ? _lastConvert.Reasons : null,
            clientJunctions, postcodeJunctions, polygonJunctions,
            depotNames, speedNames, groupNames, dropOffNames, clientCodes, clientNames,
            clientsWithoutGeocode);
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
        var polygonJunctions = await GetZoneDerivedPolygonsAsync(liveHeaderIds.ToList());

        var rows = await Context.TblBulkRunSchedules.AsNoTracking()
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.BulkPickupZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .Where(s => liveHeaderIds.Contains(s.ScheduleId))
            .OrderBy(s => s.Name)
            .ThenBy(s => s.DayOfWeek)
            .ToListAsync();

        // One lookup for the whole page rather than per group. Scoped to the
        // clients actually linked here, so it stays small (spec 4.5).
        var clientsWithoutGeocode = await GetClientsWithoutGeocodeAsync(
            clientJunctions.Select(x => x.ClientId));

        // Which of these schedules have collapsed. One query for the page.
        var headerIdsOnPage = headersById.Keys.ToList();
        var detailsById = await Context.BulkRunScheduleDetails.AsNoTracking()
            .Where(d => headerIdsOnPage.Contains(d.ScheduleId))
            .ToDictionaryAsync(d => d.ScheduleId);

        var groups = rows
            .GroupBy(r => r.ScheduleId)
            .Where(g => headersById.ContainsKey(g.Key))
            .Select(g =>
            {
                var header = headersById[g.Key];
                var scoped = clientJunctions.Where(cj => cj.ScheduleId == header.ScheduleId).ToList();
                detailsById.TryGetValue(g.Key, out var detail);
                // No refusal reasons on a read: nothing was attempted here.
                return MapGroup(header, g.ToList(), detail, null,
                    scoped, postcodeJunctions, polygonJunctions,
                    depotNames, speedNames, groupNames, dropOffNames, clientCodes, clientNames,
                    clientsWithoutGeocode);
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

        // Labelled, depot-scoped zones for the chain editor (US coverage spec
        // 5.1). zoneNumbers above stays exactly as it was, both because the
        // older schedule modal reads it and because it is the only thing that
        // can offer a number the tenant has ticked but can no longer resolve.
        //
        // It is also why this exists. That list unions BulkZoneSchedule, the
        // table the picker WRITES to, so it is self-feeding: one tick and the
        // number is offered forever, with no name, no depot and no way to see
        // what it covers. Medical Couriers has 77 ticks made that way.
        //
        // US ONLY, deliberately. The coverage spec is a US change and NZ was
        // left alone (Kevin, 27 Oct): an NZ leg keeps offering every zone
        // number the tenant uses, unfiltered, exactly as it always has.
        // Filtering NZ would have been defensible, since its availability
        // function tests p.DepotId = s.Region too, but it is a visible change
        // nobody asked for - measured on Urgent staging, 545 of 24,068 active
        // ticks would have started rendering greyed.
        //
        // An empty list here is the signal the chain editor falls back on, so
        // NZ needs no tenant knowledge of its own.
        //
        // Grouping and counting happen in SQL: the biggest US tenant has
        // 4,437 ZoneZip rows and this runs every time the modal opens.
        var zones = IsUsTenant()
            ? await BuildUsZoneOptionsAsync()
            : new List<ZoneOptionDto>();

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
            zoneNumbers, zones, storageStates, deliveryStates, pickupBoxDiscounts);
    }

    /// <summary>
    /// US tickable zones: one entry per (depot, zone number). A zone with no
    /// depot is left out because the availability function joins
    /// ZoneName.LocationID to the schedule's region, so it could never match;
    /// a ZIP row with no number is left out because the number IS the key a
    /// tick resolves by.
    ///
    /// Two zones at one depot may share a number and that is legitimate: the
    /// tick then covers both, so both names appear in the label joined with
    /// " + ". Medical Couriers depot 35 has Sacramento and SMF on number 1.
    /// </summary>
    private async Task<List<ZoneOptionDto>> BuildUsZoneOptionsAsync()
    {
        var rows = Context.ZoneZips.AsNoTracking()
            .Where(z => z.ZoneNumber != null
                     && z.ZoneName != null
                     && z.ZoneName.LocationId != null);

        // Counted in SQL rather than by pulling every ZIP row back.
        var counts = await rows
            .GroupBy(z => new { Depot = z.ZoneName.LocationId!.Value, Zone = z.ZoneNumber!.Value })
            .Select(g => new { g.Key.Depot, g.Key.Zone, Zips = g.Count() })
            .ToListAsync();

        // One row per zone that carries a number, not per ZIP.
        var named = await rows
            .Select(z => new
            {
                Depot = z.ZoneName.LocationId!.Value,
                Zone = z.ZoneNumber!.Value,
                ZoneName = z.ZoneName.ZoneName1,
                Group = z.ZoneName.ZoneGroup != null ? z.ZoneName.ZoneGroup.Name : null,
            })
            .Distinct()
            .ToListAsync();

        var labels = named
            .GroupBy(r => new { r.Depot, r.Zone })
            .ToDictionary(
                g => (g.Key.Depot, g.Key.Zone),
                g => (
                    Label: Join(g.Select(x => x.ZoneName)),
                    Group: Join(g.Select(x => x.Group))));

        return counts
            .Select(c =>
            {
                labels.TryGetValue((c.Depot, c.Zone), out var l);
                return new ZoneOptionDto(
                    c.Zone,
                    string.IsNullOrWhiteSpace(l.Label) ? $"Zone {c.Zone}" : l.Label,
                    c.Depot,
                    c.Zips,
                    l.Group ?? "");
            })
            .OrderBy(z => z.DepotId).ThenBy(z => z.Zone)
            .ToList();

        static string Join(IEnumerable<string> values) =>
            string.Join(" + ", values
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .Select(v => v.Trim())
                .Distinct()
                .OrderBy(v => v));
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
        // The WRITE entity, not the view. 20261009177000 turned
        // dbo.tblBulkRunSchedule into a view (IS_UPDATABLE = NO), so every
        // write in this method targets tblBulkRunScheduleDay. Reads elsewhere
        // in this service still go through the view, which is the only place
        // a converted schedule's payload can be read from.
        List<TblBulkRunScheduleDay> existing;
        // Child rows keyed by DAY-ROW id. They used to be reached through
        // navigation collections on the view entity; mirroring those
        // collections onto the write entity makes EF mint a shadow FK per
        // child (tried and reverted 2026-10-09, ScheduleModelShapeTests
        // caught it), so the write path carries its own lookups and sets the
        // FK column directly.
        var zonesByDayRow = new Dictionary<int, List<BulkZoneSchedule>>();
        var pickupZonesByDayRow = new Dictionary<int, List<BulkPickupZoneSchedule>>();
        var linehaulsByDayRow = new Dictionary<int, List<TblBulkScheduleLinehaul>>();
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
        // Origin (schedule-origin spec 5.1). Anything the caller does not
        // recognise falls back to 'depot', which is today's behaviour, so the
        // legacy POST /api/schedules contract is unaffected. The origin region
        // is only meaningful for a client origin; a depot-origin schedule gets
        // NULL so CK_tblBulkRunScheduleHeader_ClientOriginHasRegion stays
        // satisfied either way.
        //
        // 'direct' (2026-10-08) is the third origin: the goods leave the
        // pickup address the BOOKING declares and go straight to the delivery
        // address, so no depot is touched at all. It differs from 'client' in
        // three ways that are all enforced below - no linehaul legs, no
        // origin region, and a default schedule may use it (there is no
        // client-specific address to be undefined).
        var originType =
            string.Equals(req.OriginType, "client", StringComparison.OrdinalIgnoreCase) ? "client"
            : string.Equals(req.OriginType, "direct", StringComparison.OrdinalIgnoreCase) ? "direct"
            : "depot";
        // OriginRegionId is meaningful for 'client' only. 'direct' shares the
        // NULL with 'depot': its dispatch/reporting region is the schedule's
        // own Region, taken from the Delivery leg like everybody else's.
        var originRegionId = originType == "client" ? req.OriginRegionId : null;
        if (originType == "client" && originRegionId is null)
            throw new InvalidOperationException(
                "A client-origin schedule needs an origin region.");
        if (originType == "direct"
            && (req.BookPickup == true || (req.Linehauls?.Count ?? 0) > 0))
            throw new InvalidOperationException(
                "A Direct schedule books one job from the pickup address given "
                + "at booking time; remove the Collection and linehaul legs or "
                + "choose Depot.");

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
            // Spec 6.1 rule 1: IsDefault is an explicit header setting, so an
            // update writes it. Assigned BEFORE the client-origin guard below
            // on purpose: the guard reads header.IsDefault, and an operator
            // turning a schedule client-specific AND client-origin in one save
            // would otherwise be refused on the value the schedule had before
            // the save. Null leaves it alone, so a pre-6.1 caller is unchanged.
            if (req.IsDefault.HasValue) header.IsDefault = req.IsDefault.Value;
            // Spec 2.1: a default schedule cannot start at a client address,
            // because "the client" is not defined for a schedule every client
            // can book. Enforced here rather than in the UI so the API cannot
            // be used to get around it.
            //
            // 'direct' is deliberately NOT caught by this: its pickup address
            // comes from the booking, so it is defined for every client and a
            // default Direct schedule is a legitimate shape.
            if (originType == "client" && header.IsDefault)
                throw new InvalidOperationException(
                    "A default schedule cannot start at a client address. "
                    + "Link it to a client first.");
            header.OriginType = originType;
            header.OriginRegionId = originRegionId;
            existing = await Context.TblBulkRunScheduleDays
                .Where(s => s.ScheduleId == header.ScheduleId)
                .ToListAsync();
            var dayRowIds = existing.Select(s => s.BulkRunScheduleId).ToList();
            zonesByDayRow = (await Context.BulkZoneSchedules
                    .Where(z => z.ScheduleId != null && dayRowIds.Contains(z.ScheduleId.Value))
                    .ToListAsync())
                .GroupBy(z => z.ScheduleId.Value)
                .ToDictionary(g => g.Key, g => g.ToList());
            pickupZonesByDayRow = (await Context.BulkPickupZoneSchedules
                    .Where(z => dayRowIds.Contains(z.ScheduleId))
                    .ToListAsync())
                .GroupBy(z => z.ScheduleId)
                .ToDictionary(g => g.Key, g => g.ToList());
            linehaulsByDayRow = (await Context.TblBulkScheduleLinehauls
                    .Where(l => l.BulkRunScheduleId != null
                                && dayRowIds.Contains(l.BulkRunScheduleId.Value))
                    .ToListAsync())
                .GroupBy(l => l.BulkRunScheduleId.Value)
                .ToDictionary(g => g.Key, g => g.ToList());
        }
        else
        {
            // Fresh default header + day rows.
            header = new BulkRunScheduleHeader
            {
                Name = name,
                // Spec 6.1 rule 1. Was hardcoded true, which is why a new
                // schedule could not be created client-specific at all: the
                // operator had to create it as a default, save, then attach.
                // Unset still means true, so the legacy POST /api/schedules
                // contract ("create always makes a default") is preserved for
                // callers that do not send the field.
                IsDefault = req.IsDefault ?? true,
                LegacyClientId = null,
                CreatedUtc = DateTime.UtcNow,
                CreatedBy = "RoutedOps",
                DisplayName = displayName,
                DisplayDescription = displayDescription,
                IsActive = isActive,
                // Spec 2.1 again, now conditional. Create used to be
                // unconditionally default, so a client origin was refused
                // outright here; since 6.1 a create can be client-specific, and
                // the rule that actually matters is the 2.1 one: a DEFAULT
                // schedule cannot start at a client address, because "the
                // client" is undefined for a schedule every client can book.
                // A create that declares itself non-default is allowed the
                // client origin straight away.
                // 'direct' passes straight through either way - its pickup
                // address comes from the booking, so a default Direct schedule
                // is a legitimate shape.
                OriginType = originType == "client" && (req.IsDefault ?? true)
                    ? throw new InvalidOperationException(
                        "A default schedule cannot start at a client address. "
                        + "Set it to specific clients, or create it, link a "
                        + "client, then set the origin.")
                    : originType,
                OriginRegionId = originRegionId,
            };
            Context.BulkRunScheduleHeaders.Add(header);
            existing = new List<TblBulkRunScheduleDay>();
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
                // The day row itself is NOT deleted. Other tables hold its id
                // as a foreign key (ShopWindow, BulkZoneSchedule,
                // TblBulkScheduleLinehaul, tblRouteSchedule) and the booking
                // procedures pack it into a quote, so the id is a live
                // external contract. A schedule stops running on a weekday by
                // losing that bit from its detail row's mask, which is what
                // the convert step below writes, and the view then stops
                // emitting the day. uspScheduleConvert refuses to mask off a
                // day an active ShopWindow points at, which is the same
                // protection the foreign key used to give the delete.
                //
                // Until the schedule converts, the row has to stop being
                // offered some other way, and the only lever the old shape
                // has is its payload: a row with no window is not bookable.
                // So the payload is cleared here and the key columns kept.
                if (zonesByDayRow.TryGetValue(row.BulkRunScheduleId, out var zs))
                    Context.BulkZoneSchedules.RemoveRange(zs);
                if (pickupZonesByDayRow.TryGetValue(row.BulkRunScheduleId, out var pzs))
                    Context.BulkPickupZoneSchedules.RemoveRange(pzs);
                if (linehaulsByDayRow.TryGetValue(row.BulkRunScheduleId, out var lhs))
                    Context.TblBulkScheduleLinehauls.RemoveRange(lhs);
                ClearDayRowPayload(row);
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
                row = new TblBulkRunScheduleDay
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
                Context.TblBulkRunScheduleDays.Add(row);
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
            // F11 Phase C (Steve 2026-09-24): absolute cutoff pair is the
            // canonical shape. Legacy CutoffHours is still written so the
            // list-card summary + any tenant SP not yet on Phase B fall
            // through to a valid integer offset. DeriveLegacyCutoffHours
            // produces the same offset the adhoc back-fill script uses.
            row.CutoffDay = w.CutoffDay.HasValue ? (byte?)w.CutoffDay.Value : null;
            row.CutoffTime = ParseNullableTime(w.CutoffTime);
            row.CutoffHours = DeriveLegacyCutoffHours(row.CutoffDay, row.CutoffTime, row.DayOfWeek, row.StartTime);
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
        // Removals can be issued now; the inserts need day-row ids, so they
        // are deferred to after the first save. A row created in this same
        // call has BulkRunScheduleId = 0 until then.
        foreach (var row in existing)
        {
            if (req.Zones != null && zonesByDayRow.TryGetValue(row.BulkRunScheduleId, out var zs))
                Context.BulkZoneSchedules.RemoveRange(zs);
            if (req.PickupZones != null && pickupZonesByDayRow.TryGetValue(row.BulkRunScheduleId, out var pzs))
                Context.BulkPickupZoneSchedules.RemoveRange(pzs);
            if (req.Linehauls != null && linehaulsByDayRow.TryGetValue(row.BulkRunScheduleId, out var lhs))
                Context.TblBulkScheduleLinehauls.RemoveRange(lhs);
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

        // Spec 6.1 rule 3: a schedule that is neither default nor configured
        // for anybody is bookable by nobody, so refuse that state rather than
        // persist it. Enforced here, next to the client-origin guard and for
        // the same reason: the UI can hide the combination but the API has to
        // be the thing that cannot be talked into it.
        //
        // The test is on the DESIRED set, not the rows on disk, because this
        // runs before SaveChanges and resolvedClientIds is authoritative: an
        // operator removing the last chip from a non-default schedule is the
        // case to catch, and its link row is still present at this point.
        //
        // LegacyClientId counts as configured. A pre-junction per-client
        // schedule carries its one client in that column and has no link row
        // at all, so counting only link rows would make every legacy
        // client-specific schedule unsaveable.
        if (!header.IsDefault
            && resolvedClientIds.Count == 0
            && !header.LegacyClientId.HasValue)
            throw new InvalidOperationException(
                "A schedule for specific clients needs at least one client. "
                + "Configure a client, or set it to all clients.");

        await SyncClientsAsync(header, resolvedClientIds);
        await SyncPostcodesAsync(header, req.PostcodeIds);
        // tblSchedulePolygon is retired (custom-polygons spec 3.4). No stored
        // procedure, function, trigger or view ever read it, so a polygon
        // attached to a schedule never affected booking: the attachment was
        // wired to the wrong object. Coverage now comes from a polygon's
        // membership of a ZONE (BulkZonePolygon), which is what zone groups
        // actually decide bookability from.
        //
        // The write is removed rather than the call, so existing rows survive
        // until the drop migration runs and nothing new accumulates. Zero rows
        // on all four tenants as at 2026-10-07, so there is nothing to carry
        // across by hand.
        // await SyncPolygonsAsync(header.Name, req.PolygonIds);

        // Two phases, because the child rows' foreign key is the day row's
        // identity and a day row created in this call has no id until it is
        // saved. Both phases plus the convert run inside one transaction so
        // the intermediate old-shape state is never visible to another
        // reader, and so a failure in any of them leaves the schedule as it
        // was. BeginTransaction is relational-only; the in-memory provider
        // the service tests run on has no transactions and needs none,
        // because each test owns its own store.
        // Only open one if the caller has not. EF throws "A transaction is
        // already in progress" on a second BeginTransaction, so a caller that
        // wraps several service calls in its own transaction, which is how a
        // throwaway verification run against a real database rolls itself
        // back, would otherwise fail here rather than being accommodated.
        // When the caller owns the transaction, the caller commits it.
        IDbContextTransaction tx = null;
        if (Context.Database.IsRelational() && Context.Database.CurrentTransaction == null)
            tx = await Context.Database.BeginTransactionAsync();
        try
        {
            // An already-collapsed schedule goes back on its day rows first.
            //
            // Everything below writes the OLD shape and then asks the
            // database to collapse it, because that is the only way the
            // relative cutoff rule gets derived by the one implementation
            // that owns it. On a schedule that already has a detail row the
            // collapse refuses with DetailAlreadyExists, and the save then
            // left the day rows carrying payload they should not have while
            // the detail row kept its old window and cutoff. The view reads
            // the detail row, so nothing looked wrong on screen: the
            // operator's edit simply did nothing, which is worse than an
            // error. Putting the schedule back first makes both shapes take
            // one path.
            //
            // Found by saving a collapsed schedule in the real application,
            // and then again when the first attempt failed on permissions:
            // uspScheduleUnconvert needs EXECUTE AS OWNER to reach its
            // SET IDENTITY_INSERT, which 20261009178300 gives it.
            if (_converter != null
                && await Context.BulkRunScheduleDetails
                        .AnyAsync(d => d.ScheduleId == header.ScheduleId))
            {
                await _converter.UnconvertAsync(Context, header.ScheduleId);
            }

            await Context.SaveChangesAsync();

            // Phase 2: children, now that every day row has an id.
            foreach (var row in existing)
            {
                if (req.Zones != null)
                    foreach (var z in req.Zones)
                        Context.BulkZoneSchedules.Add(new BulkZoneSchedule
                        {
                            ScheduleId = row.BulkRunScheduleId,
                            Zone = z.Zone,
                            Active = z.Active,
                        });
                if (req.PickupZones != null)
                    foreach (var z in req.PickupZones)
                        Context.BulkPickupZoneSchedules.Add(new BulkPickupZoneSchedule
                        {
                            ScheduleId = row.BulkRunScheduleId,
                            Zone = z.Zone,
                            Active = z.Active ?? true,
                        });
                if (req.Linehauls != null)
                    // Bug 1 (Steve 2026-09-25): this is a remove-and-re-add, so
                    // every leg gets a fresh identity Id and the backfilled
                    // LegOrder would be lost unless it is written back here. The
                    // ordinal is the leg's position in the request array, which
                    // the chain editor sends in travel order, so a caller that
                    // does not know about LegOrder still produces the right
                    // order just by sending legs in chain order.
                    for (var i = 0; i < req.Linehauls.Count; i++)
                    {
                        var leg = MapLinehaulToEntity(req.Linehauls[i], i + 1);
                        leg.BulkRunScheduleId = row.BulkRunScheduleId;
                        Context.TblBulkScheduleLinehauls.Add(leg);
                    }
            }
            if (req.Zones != null || req.PickupZones != null || req.Linehauls != null)
                await Context.SaveChangesAsync();

            // Convert-on-save (collapse plan 4.1, decided 8 Oct). The write
            // above is deliberately in the OLD shape, per-day payload and an
            // absolute cutoff pair, because that is what the request carries.
            // The procedure turns it into the one relative rule the detail
            // row stores, trying working days then calendar days, and nulls
            // the day-row payload. It refuses when the days genuinely differ,
            // and a refusal is a normal answer: the schedule stays in the old
            // shape, still correct, still bookable, and the reasons come back
            // for the operator.
            //
            // This is the whole migration of existing data in the plan:
            // opportunistic, on touch, no campaign.
            _lastConvert = _converter == null
                ? null
                : await _converter.ConvertAsync(Context, header.ScheduleId, commit: true, by: "RoutedOps");
            // Both procedures changed rows underneath EF. Anything still
            // tracked from the writes above now holds pre-collapse values,
            // and the read that builds the response would hand those back.
            Context.ChangeTracker.Clear();
            if (_lastConvert != null && !_lastConvert.CanConvert)
                _logger.LogInformation(
                    "Schedule {ScheduleId} saved in the old shape; convert refused: {Reasons}",
                    header.ScheduleId, _lastConvert.Reasons);

            // The operator's occurrences-ahead, applied AFTER the convert
            // because the convert is what creates the detail row to hold it,
            // and it writes one week's worth as the default. An old-shape
            // schedule has nowhere to put the value, so the request field is
            // silently inapplicable there rather than an error: the operator
            // is told the schedule did not collapse, and that is the thing
            // to act on.
            if (req.OccurrencesAhead.HasValue)
            {
                if (req.OccurrencesAhead.Value is < 1 or > 60)
                    throw new InvalidOperationException(
                        "Occurrences ahead must be between 1 and 60.");
                var detailRow = await Context.BulkRunScheduleDetails
                    .FirstOrDefaultAsync(d => d.ScheduleId == header.ScheduleId);
                if (detailRow != null && detailRow.OccurrencesAhead != req.OccurrencesAhead.Value)
                {
                    detailRow.OccurrencesAhead = req.OccurrencesAhead.Value;
                    detailRow.UpdatedUtc = DateTime.UtcNow;
                    detailRow.UpdatedBy = "RoutedOps";
                    await Context.SaveChangesAsync();
                }
            }

            if (tx != null) await tx.CommitAsync();
        }
        finally
        {
            if (tx != null) await tx.DisposeAsync();
        }

        // Patch this one schedule into the cached list rather than dropping
        // the list. Only the save does this: it is the heavy write, it is the
        // one operators repeat, and it is the one whose settling locks made
        // the next reader's rebuild take 19.9s. The lighter writes below
        // still invalidate, which costs a rebuild but not a blocked one.
        await RefreshListSummaryEntryAsync(header.ScheduleId);

        return await GetDetailByHeaderAsync(header);
    }

    /// <summary>
    /// The outcome of the last convert-on-save, for the caller that wants to
    /// tell the operator why a schedule did not collapse. Null means the
    /// convert was not attempted, which is the case on a provider with no
    /// stored procedures; it never means refused.
    /// </summary>
    private ScheduleConvertResult _lastConvert;

    /// <summary>
    /// Why the schedule saved by the most recent <see cref="UpsertAsync"/>
    /// call did not collapse onto one row, or null when it did collapse or
    /// the question does not apply.
    /// </summary>
    public string LastConvertRefusalReasons =>
        _lastConvert is { CanConvert: false } ? _lastConvert.Reasons : null;

    /// <summary>
    /// Blanks every payload column on a day row, leaving the key columns
    /// (Name, ClientId, ScheduleId, DayOfWeek) set.
    ///
    /// This is what a key row looks like, and it is what the row becomes
    /// when the operator un-ticks its weekday. The row survives because
    /// other tables hold its id; see the comment at the call site.
    /// </summary>
    /// <summary>
    /// Blank a day row the request no longer describes. The row is kept, not
    /// deleted, because other tables hold its id (see the caller).
    ///
    /// MaxJobs and CutoffHours are set to 0 rather than NULL, and that is not
    /// cosmetic. `dbo.tblBulkRunSchedule` is a compatibility VIEW over this
    /// table and EF maps BOTH of those columns as non-nullable `int`
    /// (TblBulkRunSchedule.Schedules.cs and BulkImportEntityExtensions.cs), so
    /// a NULL makes every read of that schedule throw SqlNullValueException
    /// out of the materialiser. It is not contained either: the list query
    /// reads the same view, so one cleared row takes the whole Schedules NEW
    /// list down with a 500 until the row is repaired by hand.
    ///
    /// The mask on the detail row normally hides a cleared row, which is why
    /// this went unnoticed: the convert runs straight after this and the view
    /// stops emitting the day. But the convert REFUSES whenever the days
    /// genuinely differ, and the caller treats a refusal as a normal answer
    /// ("the schedule stays in the old shape, still correct, still bookable").
    /// On a refusal there is no detail row, the view's `x.ScheduleId IS NULL`
    /// arm emits every day row regardless, and the cleared row surfaces with
    /// its NULLs. Found 2026-10-20 on a schedule that could not convert.
    ///
    /// 0 is the value the old table actually held for this case, not a default
    /// invented here. 20261009178200_CompatView_CutoffHoursNeverNullAfterCollapse
    /// makes exactly this argument for the collapsed arm of the same column,
    /// and DeriveLegacyCutoffHours returns 0 the moment the absolute pair is
    /// unset. The row still stops being bookable the way the caller intends,
    /// through StartTime and EndTime going NULL: MaxJobs is carried by the
    /// availability functions but never gates anything in them.
    /// </summary>
    private static void ClearDayRowPayload(TblBulkRunScheduleDay row)
    {
        row.StartTime = null;
        row.EndTime = null;
        row.MaxJobs = 0;
        row.Region = null;
        row.SpeedId = null;
        row.CutoffHours = 0;
        row.CutoffDay = null;
        row.CutoffTime = null;
        row.Description = null;
        row.AutoBook = null;
        row.PostcodeGroupId = null;
        row.BookPickup = null;
        row.PickupDepotId = null;
        row.StorageState = null;
        row.DeliveryState = null;
        row.PickupRatingSpeed = null;
        row.PickupPostcodeGroupId = null;
        row.ParentSpeedId = null;
        row.PickupBoxDiscount = null;
        row.DropOffLocationId = null;
        row.ApplyPickupCutoff = null;
        row.PickupCutoff = null;
        row.AutoBookScanAhead = null;
        row.IsRecurringSchedule = null;
    }

    /// <summary>
    /// The next <paramref name="count"/> runs this schedule would offer,
    /// starting from now. Read-only; nothing is written and no booking is
    /// made.
    ///
    /// WHY IT EXISTS: "occurrences ahead" is a bare number, and a number
    /// does not tell an operator whether 3 means this week or next. The
    /// detail modal renders this under the field so changing N shows its
    /// effect immediately.
    ///
    /// WHAT IT DELIBERATELY DOES NOT DO: re-derive any booking rule. The
    /// cutoff moment is the run start minus CutoffHours, and CutoffHours
    /// comes from the database, where the compatibility view resolved it
    /// through fnCutoffHoursFor for a collapsed schedule and passed the
    /// stored offset through for an old-shape one. The working-day versus
    /// calendar-day rule lives in SQL and stays there. All this method adds
    /// is calendar walking: which dates fall on a masked weekday, which are
    /// holidays, which are already past their cutoff.
    ///
    /// WHERE IT CAN DISAGREE WITH THE BOOKING PAGE, and it is a preview so
    /// this is acceptable, but it should be said rather than discovered:
    ///   * no client. A per-client OccurrencesAhead override, and any
    ///     client-specific cutoff exception, are not applied. The preview
    ///     answers for the schedule, which is what the field edits.
    ///   * no zone or region matching. The booking page also has to find
    ///     the client's postcode in the schedule's zones; a date shown here
    ///     is offered only to clients the schedule actually covers.
    ///   * fnCutoffHoursFor rounds up to whole hours, so a cutoff at 16:30
    ///     previews as 17 hours before rather than 16.5.
    /// </summary>
    /// <summary>
    /// When ordering closes for one run. F23 (Anisah's 14 to 16 Oct smoke
    /// test): the same expression as
    /// UTL_fncJob_GetClientAvailableBulkRunSchedule, which the preview did
    /// not share. It only ever did the relative form, so a schedule with an
    /// absolute day-before cutoff previewed a date the booking page had
    /// already closed.
    ///
    /// Extracted rather than left inline so it can be tested without a
    /// clock: the caller's "now" comes from the tenant database, which a
    /// unit test cannot pin, and a test that depends on the real time of day
    /// is the kind that passes locally and fails on a slow runner.
    ///
    /// An absolute pair names a weekday and a time, and the offset lands on
    /// the most recent occurrence of that weekday at or before the run day:
    /// 0 for a same-day cutoff, -1 for the day before, -3 for "the previous
    /// Friday" on a Monday run. The expression is non-negative before the
    /// modulo for every valid ISO day pair, so it matches T-SQL's % exactly
    /// rather than only usually.
    /// </summary>
    /// Public rather than internal because this repo deliberately avoids
    /// InternalsVisibleTo (see RecurringLinehaulJobsPagingTests), and a pure
    /// static with no state is the cheapest thing to expose.
    public static DateTime CutoffFor(
        DateTime runDate, int isoDay, TimeSpan startTime,
        int cutoffHours, byte? cutoffDay, TimeSpan? cutoffTime)
    {
        if (cutoffDay.HasValue && cutoffTime.HasValue)
        {
            var dayOffset = ((cutoffDay.Value - isoDay + 6) % 7) - 6;
            return runDate.AddDays(dayOffset) + cutoffTime.Value;
        }
        return runDate + startTime - TimeSpan.FromHours(cutoffHours);
    }

    /// <param name="count">
    /// How many to return. Null uses the schedule's own value, which is
    /// what the field currently holds; the modal passes the number the
    /// operator has typed so the preview tracks an unsaved edit.
    /// </param>
    public async Task<List<ScheduleOccurrenceDto>> PreviewOccurrencesAsync(int scheduleId, int? count)
    {
        var header = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .FirstOrDefaultAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null)
            ?? throw new InvalidOperationException($"Schedule id {scheduleId} not found or retired.");

        // Through the view, so a collapsed schedule hands over the payload
        // synthesised from its detail row and an old-shape one its day rows.
        // One code path for both shapes, which is the whole point of the view.
        var days = await Context.TblBulkRunSchedules.AsNoTracking()
            .Where(s => s.ScheduleId == scheduleId)
            // F23: CutoffDay and CutoffTime were not even selected, which is
            // why the absolute pair could not be honoured below.
            .Select(s => new { s.DayOfWeek, s.StartTime, s.CutoffHours, s.CutoffDay, s.CutoffTime })
            .ToListAsync();
        if (days.Count == 0) return new List<ScheduleOccurrenceDto>();

        var detail = await Context.BulkRunScheduleDetails.AsNoTracking()
            .FirstOrDefaultAsync(d => d.ScheduleId == scheduleId);

        // Resolution order matches fnScheduleForClient's, minus the client
        // level this preview does not have: asked-for, then the schedule's
        // own, then one week's worth.
        var wanted = count
            ?? detail?.OccurrencesAhead
            ?? days.Select(d => d.DayOfWeek).Distinct().Count();
        if (wanted < 1) return new List<ScheduleOccurrenceDto>();
        if (wanted > MaxOccurrencesAhead) wanted = MaxOccurrencesAhead;

        // F23: tenant-local now, from the same function the availability
        // path uses, so the preview and the booking page cannot disagree
        // about what time it is. DateTime.Now was the SERVER clock, which on
        // a US tenant is a different day from the one the operator is in.
        //
        // The provider test is for the test harness only: SQLite has no
        // scalar functions, and falling back to UTC there keeps the unit
        // tests runnable without pretending the fallback is correct for
        // production. ProviderName rather than IsRelational() because SQLite
        // is relational too.
        var isSqlServer = Context.Database.ProviderName?
            .Contains("SqlServer", StringComparison.OrdinalIgnoreCase) == true;
        var now = isSqlServer
            ? await Context.Database
                .SqlQuery<DateTime>($"SELECT dbo.UTL_GetTenantLocalDateTime() AS Value")
                .SingleAsync()
            : DateTime.UtcNow;
        var from = now.Date;
        var until = from.AddDays(OccurrencePreviewHorizonDays);

        // Holidays that block booking, over the horizon only. CanBook = 1 is
        // a holiday the tenant still takes work on, so it does not skip the
        // date; that is the same reading _fncJob_GetClientAvailableSpeed's
        // callers use.
        var holidays = await Context.TblHolidays.AsNoTracking()
            .Where(h => h.Date >= from && h.Date <= until && !h.CanBook)
            .Select(h => h.Date)
            .ToListAsync();
        var blocked = holidays.Select(h => h.Date).ToHashSet();

        // One entry per weekday the schedule runs. A schedule can carry more
        // than one day row for a weekday (one per speed); they share the
        // date, so the earliest start wins and the date is offered once.
        var byWeekday = days
            .Where(d => d.DayOfWeek is >= 1 and <= 7 && d.StartTime.HasValue)
            .GroupBy(d => (int)d.DayOfWeek!.Value)
            .ToDictionary(g => g.Key, g => g.OrderBy(d => d.StartTime!.Value).First());

        var result = new List<ScheduleOccurrenceDto>();
        for (var date = from; date <= until && result.Count < wanted; date = date.AddDays(1))
        {
            // .NET counts Sunday as 0; the day rows count Monday as 1.
            var isoDay = date.DayOfWeek == System.DayOfWeek.Sunday ? 7 : (int)date.DayOfWeek;
            if (!byWeekday.TryGetValue(isoDay, out var row)) continue;
            if (blocked.Contains(date)) continue;

            var start = date + row.StartTime!.Value;

            var cutoff = CutoffFor(date, isoDay, row.StartTime!.Value,
                row.CutoffHours, row.CutoffDay, row.CutoffTime);

            // Already closed, so the booking page would not offer it, and a
            // preview that showed it would be telling the operator something
            // untrue about today.
            if (now > cutoff) continue;

            result.Add(new ScheduleOccurrenceDto(
                date.ToString("yyyy-MM-dd"),
                isoDay,
                start.ToString("HH:mm"),
                cutoff.ToString("yyyy-MM-dd HH:mm"),
                now.ToString("yyyy-MM-dd HH:mm")));
        }
        return result;
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
        // Retiring REMOVES the row: the recompute filters on RetiredUtc being
        // null, comes back empty, and the patch drops the entry.
        await RefreshListSummaryEntryAsync(header.ScheduleId);
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
        // Retiring REMOVES the row: the recompute filters on RetiredUtc being
        // null, comes back empty, and the patch drops the entry.
        await RefreshListSummaryEntryAsync(header.ScheduleId);
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
            .Include(s => s.BulkPickupZoneSchedules)
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
        else if (req.CopyClientLinks)
        {
            // Inherit source header's junction clients.
            targetClientIds = await Context.ScheduleClients.AsNoTracking()
                .Where(x => x.ScheduleId == source.ScheduleId)
                .Select(x => x.ClientId)
                .ToListAsync();
        }
        else
        {
            // Caller named no clients and opted out of inheriting. The copy
            // starts as a default group with no client link rows.
            targetClientIds = new List<int>();
        }

        var srcPostcodes = await Context.SchedulePostcodes.AsNoTracking()
            .Where(x => x.ScheduleId == source.ScheduleId)
            .Select(x => x.PostCode)
            .ToListAsync();
        // Retired with the junction (spec 3.4). Kept as an empty list so the
        // copy path reads the same shape until the dead call below goes.
        var srcPolygons = new List<int>();

        // New header + day-row clones + junction rows in one atomic save.
        // CLIENT origin is deliberately NOT copied. A copy is created as a
        // default header, and a default schedule cannot start at a client
        // address (spec 2.1), so carrying OriginType = 'client' across would
        // produce a row that violates its own rule. Such a copy lands as depot
        // origin and the operator sets it after linking the client, the same
        // order the create path forces.
        //
        // DIRECT origin IS copied (2026-10-08). The reason client origin
        // cannot be carried is that the address is client-specific, so it
        // means nothing on a default header. A Direct schedule has no
        // client-specific address at all - its pickup address arrives with the
        // booking - so the copy is meaningful as-is, and dropping it would
        // silently turn a Direct schedule into a depot one.
        var copiedOriginType =
            string.Equals(source.OriginType, "direct", StringComparison.OrdinalIgnoreCase)
                ? "direct" : "depot";
        var newHeader = new BulkRunScheduleHeader
        {
            Name = newName,
            IsDefault = true,
            LegacyClientId = null,
            CreatedUtc = DateTime.UtcNow,
            CreatedBy = "RoutedOps",
            OriginType = copiedOriginType,
            // NULL either way: 'depot' never has one and 'direct' forces it
            // null (its dispatch region is the day row's Region).
            OriginRegionId = null,
        };
        Context.BulkRunScheduleHeaders.Add(newHeader);

        // src is read through the view, so a converted source hands over its
        // synthesised payload and the copy starts life in the old shape with
        // the same values. The convert at the end collapses it again.
        var clones = new List<(TblBulkRunScheduleDay Clone, TblBulkRunSchedule Src)>();
        foreach (var src in sourceRows)
        {
            var clone = new TblBulkRunScheduleDay
            {
                Name = newName,
                // Legacy ClientId column on day row - see UpsertAsync for
                // full rationale. New copy is always a default header
                // (LegacyClientId is null), so day-row ClientId stays
                // null too - matches the legacy convention where
                // default-schedule day rows carry ClientId IS NULL.
                ClientId = newHeader.LegacyClientId,
                Header = newHeader, // EF wires ScheduleId on save
                // The view declares DayOfWeek nullable; the day table does not
                // (smallint NOT NULL), so a null here is corrupt data rather
                // than a case to handle. Coalescing it would write an invalid
                // weekday that the mask and every cutoff derivation would then
                // read as Monday.
                DayOfWeek = src.DayOfWeek ?? throw new InvalidOperationException(
                    $"Day row {src.BulkRunScheduleId} has no DayOfWeek and cannot be copied."),
                StartTime = src.StartTime,
                EndTime = src.EndTime,
                // F11 Phase C (2026-09-24): copy the absolute pair plus
                // the legacy offset. Source's derived CutoffHours is still
                // valid so we carry it verbatim rather than re-deriving.
                CutoffDay = src.CutoffDay,
                CutoffTime = src.CutoffTime,
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
            Context.TblBulkRunScheduleDays.Add(clone);
            clones.Add((clone, src));
        }

        await SyncClientsAsync(newHeader, targetClientIds);
        await SyncPostcodesAsync(newHeader, srcPostcodes);
        // Polygon junction retired with the rest (spec 3.4). A copy no longer
        // carries schedule-attached polygons because nothing reads them; the
        // copy's coverage comes from its zone groups.
        // await SyncPolygonsAsync(newName, srcPolygons);

        // Two phases inside one transaction, for the same reason as
        // UpsertAsync: the child rows' foreign key is the clone's identity,
        // which does not exist until the clone is saved.
        IDbContextTransaction copyTx = null;
        if (Context.Database.IsRelational() && Context.Database.CurrentTransaction == null)
            copyTx = await Context.Database.BeginTransactionAsync();
        try
        {
            await Context.SaveChangesAsync();

            foreach (var (clone, src) in clones)
            {
                foreach (var z in src.BulkZoneSchedules)
                    Context.BulkZoneSchedules.Add(new BulkZoneSchedule
                    {
                        ScheduleId = clone.BulkRunScheduleId,
                        Zone = z.Zone,
                        Active = z.Active,
                    });
                foreach (var z in src.BulkPickupZoneSchedules)
                    Context.BulkPickupZoneSchedules.Add(new BulkPickupZoneSchedule
                    {
                        ScheduleId = clone.BulkRunScheduleId,
                        Zone = z.Zone,
                        Active = z.Active,
                    });
                foreach (var l in src.TblBulkScheduleLinehauls)
                    Context.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
                    {
                        BulkRunScheduleId = clone.BulkRunScheduleId,
                    Name = l.Name, Active = l.Active,
                    Amount = l.Amount, AmountPercentage = l.AmountPercentage,
                    FromDepotId = l.FromDepotId, ToDepotId = l.ToDepotId,
                    InsertToBulk = l.InsertToBulk, Minutes = l.Minutes,
                    LinehaulRunId = l.LinehaulRunId,
                    ApplyDiscount = l.ApplyDiscount, ApplyAddOnPercentage = l.ApplyAddOnPercentage,
                    WeekDay = l.WeekDay, DepartureAdvanceDays = l.DepartureAdvanceDays,
                    FromClientAddress = l.FromClientAddress, DropOffLocationId = l.DropOffLocationId,
                    // Bug 1 (Steve 2026-09-25): carry the travel order, or the clone
                    // would start life unordered and its first booking would number
                    // and time the legs in Id order again.
                    LegOrder = l.LegOrder,
                    // 2026-09-28: SpeedId was missing from this initialiser since the
                    // per-leg override shipped (20260619040000_LinehaulScheduleLegSpeedId),
                    // so copying a schedule silently dropped every leg's service-class
                    // override and the copy re-rated off the run / schedule speed.
                    // Carrying it is a behaviour change to the copy path, made on
                    // Kevin's explicit call 2026-09-28.
                        SpeedId = l.SpeedId,
                        ChargePerConsignment = l.ChargePerConsignment,
                    });
            }
            await Context.SaveChangesAsync();

            // A copy of a schedule that was collapsed should be collapsed
            // too, and a copy of one that was not has the same reasons not to
            // be, so the answer is simply to try. A refusal leaves the copy
            // in the old shape, which is a faithful copy either way.
            if (_converter != null)
                await _converter.ConvertAsync(Context, newHeader.ScheduleId, commit: true, by: "RoutedOps");

            if (copyTx != null) await copyTx.CommitAsync();
        }
        finally
        {
            if (copyTx != null) await copyTx.DisposeAsync();
        }

        // A copy ADDS a row; the patch computes the new schedule and splices
        // it in, so the list does not rebuild to show one extra entry.
        await RefreshListSummaryEntryAsync(newHeader.ScheduleId);

        return await GetDetailByHeaderAsync(newHeader);
    }

    /// <summary>Toggle AutoBook across every row in the group.</summary>
    public async Task<bool> ToggleAutoBookAsync(int scheduleId)
    {
        var header = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .FirstOrDefaultAsync(h => h.ScheduleId == scheduleId && h.RetiredUtc == null)
            ?? throw new InvalidOperationException("Schedule not found.");
        // On a collapsed schedule AutoBook lives once, on the detail row, and
        // the day rows carry NULL. Writing the day rows there would set a
        // column nothing reads and leave the real value untouched, so the
        // shape decides which row to write. Reading the view and writing the
        // day table would have exactly that effect, which is why this does
        // not just swap the DbSet.
        var detail = await Context.BulkRunScheduleDetails
            .FirstOrDefaultAsync(d => d.ScheduleId == header.ScheduleId);
        if (detail != null)
        {
            var toggled = !(detail.AutoBook ?? false);
            detail.AutoBook = toggled;
            detail.UpdatedUtc = DateTime.UtcNow;
            detail.UpdatedBy = "RoutedOps";
            await Context.SaveChangesAsync();
            await RefreshListSummaryEntryAsync(scheduleId);
            return toggled;
        }

        var rows = await Context.TblBulkRunScheduleDays
            .Where(s => s.ScheduleId == header.ScheduleId)
            .ToListAsync();
        if (rows.Count == 0) throw new InvalidOperationException("Schedule has no day rows.");
        var newValue = !(rows[0].AutoBook ?? false);
        foreach (var r in rows) r.AutoBook = newValue;
        await Context.SaveChangesAsync();
        await RefreshListSummaryEntryAsync(scheduleId);
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
        await RefreshListSummaryEntryAsync(header.ScheduleId);
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

    /// <summary>
    /// Polygons that cover a schedule, derived from its ZONE groups
    /// (custom-polygons spec 3.4). Replaces the tblSchedulePolygon junction,
    /// which is being dropped: nothing ever read it, so attaching a polygon
    /// to a schedule had no effect on booking. A polygon covers a schedule
    /// when it is a member of a zone the schedule actually fulfils, in the
    /// schedule's delivery or pickup zone group.
    ///
    /// Read-only by design. The Coverage tab shows this; it no longer writes.
    /// Keyed by header ScheduleId.
    /// </summary>
    private async Task<Dictionary<int, List<int>>> GetZoneDerivedPolygonsAsync(List<int> headerIds)
    {
        if (headerIds.Count == 0) return new Dictionary<int, List<int>>();

        // (header, group, zone) triples the schedules actually fulfil, both
        // sides. A schedule with no zone rows covers nothing, which is the
        // same answer the junction gave once it stopped being written.
        var delivery = await (
            from row in Context.TblBulkRunSchedules.AsNoTracking()
            join z in Context.BulkZoneSchedules.AsNoTracking()
                on row.BulkRunScheduleId equals z.ScheduleId
            where headerIds.Contains(row.ScheduleId) && row.PostcodeGroupId != null && z.Active == true
            select new { row.ScheduleId, GroupId = row.PostcodeGroupId!.Value, z.Zone })
            .Distinct().ToListAsync();
        var pickup = await (
            from row in Context.TblBulkRunSchedules.AsNoTracking()
            join z in Context.BulkPickupZoneSchedules.AsNoTracking()
                on row.BulkRunScheduleId equals z.ScheduleId
            where headerIds.Contains(row.ScheduleId) && row.PickupPostcodeGroupId != null && z.Active
            select new { row.ScheduleId, GroupId = row.PickupPostcodeGroupId!.Value, z.Zone })
            .Distinct().ToListAsync();

        var wanted = delivery.Concat(pickup).ToList();
        if (wanted.Count == 0) return new Dictionary<int, List<int>>();

        var groupIds = wanted.Select(w => w.GroupId).Distinct().ToList();
        var members = await Context.BulkZonePolygons.AsNoTracking()
            .Where(zp => zp.Active && groupIds.Contains(zp.PostcodeGroupId))
            .Select(zp => new { zp.PostcodeGroupId, zp.Zone, zp.PolygonId })
            .ToListAsync();

        var byGroupZone = members
            .GroupBy(m => (m.PostcodeGroupId, m.Zone))
            .ToDictionary(g => g.Key, g => g.Select(x => x.PolygonId).ToList());

        return wanted
            .GroupBy(w => w.ScheduleId)
            .ToDictionary(
                g => g.Key,
                g => g.SelectMany(w =>
                        byGroupZone.TryGetValue((w.GroupId, w.Zone), out var ps)
                            ? ps : Enumerable.Empty<int>())
                      .Distinct().OrderBy(x => x).ToList());
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

    private async Task SyncPostcodesAsync(BulkRunScheduleHeader header, IEnumerable<int> desired)
    {
        // Same shape as SyncClientsAsync: a brand-new header has no id until
        // SaveChanges, so there is nothing to delete and every desired
        // postcode is an add.
        List<SchedulePostcode> current;
        if (header.ScheduleId == 0)
        {
            current = new List<SchedulePostcode>();
        }
        else
        {
            current = await Context.SchedulePostcodes
                .Where(x => x.ScheduleId == header.ScheduleId)
                .ToListAsync();
        }
        var desiredSet = new HashSet<int>(desired ?? Enumerable.Empty<int>());
        Context.SchedulePostcodes.RemoveRange(current.Where(x => !desiredSet.Contains(x.PostCode)));
        var currentSet = new HashSet<int>(current.Select(x => x.PostCode));
        foreach (var p in desiredSet.Where(p => !currentSet.Contains(p)))
        {
            Context.SchedulePostcodes.Add(new SchedulePostcode
            {
                // Both columns on purpose. ScheduleName is still half of the
                // database primary key until the step-3 migration moves it,
                // and Header lets EF fill ScheduleId even for a header that
                // has not been saved yet.
                Header = header,
                ScheduleName = header.Name,
                PostCode = p,
                CreatedUtc = DateTime.UtcNow,
            });
        }
    }


    private void ApplyGroupTemplateToRow(TblBulkRunScheduleDay row, ScheduleGroupUpsertRequest req)
    {
        row.Region = req.RegionId;

        // F24 guard (BLOCKER, Anisah 14 to 16 Oct). A depot-origin schedule
        // keeps its depot. The frontend bug that nulled it is fixed in both
        // modals, but this is the only place the column is written, so a
        // caller that simply omits the field would do the same damage just as
        // silently: a stale bundle, another UI, or a direct API call.
        //
        // Clearing IS legitimate for a client or direct origin, which both
        // store no depot, so only the depot case is defended. The suppression
        // is logged rather than thrown: refusing the save would break any
        // client that omits the field, while losing the depot silently is the
        // failure actually being fixed.
        var originIsDepot =
            !string.Equals(req.OriginType, "client", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(req.OriginType, "direct", StringComparison.OrdinalIgnoreCase);
        if (originIsDepot && req.PickupDepotId is null && row.PickupDepotId is not null)
        {
            _logger.LogWarning(
                "F24 guard: refused to clear PickupDepotId {DepotId} on day row {RowId} "
                + "for a depot-origin schedule; the request carried no depot.",
                row.PickupDepotId, row.BulkRunScheduleId);
        }
        else
        {
            row.PickupDepotId = req.PickupDepotId;
        }
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

    /// <summary>
    /// Client ids among <paramref name="clientIds"/> with no site coordinates
    /// on tucClient (schedule-origin spec 4.5). Only client-origin schedules
    /// care, so callers pass the ids they actually have and the query stays
    /// small.
    /// </summary>
    private async Task<HashSet<int>> GetClientsWithoutGeocodeAsync(IEnumerable<int> clientIds)
    {
        var ids = clientIds.Distinct().ToList();
        if (ids.Count == 0) return new HashSet<int>();
        var found = await Context.TucClients.AsNoTracking()
            .Where(c => ids.Contains(c.UcclId) && (c.Latitude == null || c.Longitude == null))
            .Select(c => c.UcclId)
            .ToListAsync();
        return found.ToHashSet();
    }

    private static ScheduleGroupDto MapGroup(
        BulkRunScheduleHeader header,
        List<TblBulkRunSchedule> rows,
        // The collapsed body, or null for an old-shape schedule. Everything
        // else in this method still reads `rows`, which come through the
        // compatibility view and therefore already carry the detail row's
        // payload spread back across the masked days. This parameter is only
        // for the two facts the view does not expose: that the schedule IS
        // collapsed, and its occurrences-ahead value.
        BulkRunScheduleDetail detail,
        // Why the save that produced this DTO did not collapse the schedule.
        // Null on a plain read.
        string convertRefusalReasons,
        List<ScheduleClient> clientJunctions,
        List<SchedulePostcode> postcodeJunctions,
        // Derived from zone membership, keyed by header ScheduleId
        // (custom-polygons spec 3.4). Was tblSchedulePolygon rows.
        Dictionary<int, List<int>> polygonsByScheduleId,
        Dictionary<int, string> depotNames,
        Dictionary<int, string> speedNames,
        Dictionary<int, string> groupNames,
        Dictionary<int, string> dropOffNames,
        Dictionary<int, string> clientCodes,
        Dictionary<int, string> clientNames,
        // Client ids with no tucClient.Latitude/Longitude. Supplied by the
        // caller because MapGroup is static and must not touch the DB.
        HashSet<int> clientsWithoutGeocode)
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
        // Computed for every schedule, not just the ones already stored as
        // client origin. The editor decides whether to SHOW it, from the live
        // chain, so the warning appears the moment the operator switches the
        // Depot leg to Client address rather than only after a save and a
        // reopen. Gating it here on the stored OriginType made the list empty
        // at exactly the moment it was needed.
        //
        // Harmless for depot origin: the client's site is never read there, so
        // the field is simply ignored.
        var clientsMissingGeocode = clientIds
            .Where(clientsWithoutGeocode.Contains)
            .Select(id => new ClientGeocodeGapDto(id, LookupClientName(id) ?? $"#{id}"))
            .ToList();
        var legacyClientCode = header.LegacyClientId.HasValue ? LookupClientCode(header.LegacyClientId.Value) : null;
        var postcodeIds = postcodeJunctions
            .Where(x => x.ScheduleId == header.ScheduleId)
            .Select(x => x.PostCode)
            .OrderBy(x => x)
            .ToList();
        var polygonIds = polygonsByScheduleId.TryGetValue(header.ScheduleId, out var derivedPolys)
            ? derivedPolys
            : new List<int>();

        var dayWindows = rows
            .OrderBy(r => r.DayOfWeek)
            .Select(r => new DayWindowDto(
                r.BulkRunScheduleId,
                r.DayOfWeek ?? 0,
                FormatTime(r.StartTime),
                FormatTime(r.EndTime),
                r.CutoffDay.HasValue ? (int?)r.CutoffDay.Value : null,
                FormatTime(r.CutoffTime)))
            .ToList();

        var zones = t.BulkZoneSchedules
            .OrderBy(z => z.Zone)
            .Select(z => new ScheduleZoneDto(z.Id, z.ScheduleId, z.Zone, z.Active))
            .ToList();
        var pickupZones = t.BulkPickupZoneSchedules
            .OrderBy(z => z.Zone)
            .Select(z => new ScheduleZoneDto(z.Id, z.ScheduleId, z.Zone, z.Active))
            .ToList();
        // Bug 1 (Steve 2026-09-25): order by travel order, not by Name. The
        // chain editor renders legs in the order this list arrives, and the
        // booking SPs walk the same LegOrder, so a Name sort would show the
        // operator a different order from the one that actually gets
        // dispatched. Legs with no LegOrder sort last, by Id, which mirrors
        // the SPs' ISNULL(LegOrder, 2147483647), Id.
        var linehauls = t.TblBulkScheduleLinehauls
            .OrderBy(l => l.LegOrder ?? int.MaxValue)
            .ThenBy(l => l.Id)
            .Select(l => new ScheduleLinehaulDto(
                l.Id, l.Name, l.Active, l.Amount, l.AmountPercentage,
                l.FromDepotId, l.ToDepotId, l.Minutes, l.LinehaulRunId,
                l.InsertToBulk, l.ApplyDiscount, l.ApplyAddOnPercentage,
                ParseWeekday(l.WeekDay), l.DepartureAdvanceDays,
                l.FromClientAddress, l.DropOffLocationId,
                l.SpeedId, LookupSpeed(l.SpeedId), l.LegOrder, l.ChargePerConsignment))
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
            // Origin lives on the header, not the day row: it is a property
            // of the schedule, not of a weekday.
            header.OriginType ?? "depot",
            header.OriginRegionId, LookupDepot(header.OriginRegionId),
            clientsMissingGeocode,
            t.AutoBook, t.BookPickup,
            t.ApplyPickupCutoff, t.PickupCutoff,
            t.StorageState, t.DeliveryState, t.PickupBoxDiscount,
            t.DropOffLocationId, LookupDropOff(t.DropOffLocationId),
            t.Description,
            dayWindows, zones, pickupZones, linehauls,
            clientIds, clientCodesForGroup, postcodeIds, polygonIds,
            clientLinkedUtcs, clientNamesForGroup,
            header.DisplayName, header.DisplayDescription, header.IsActive,
            detail != null,
            detail?.OccurrencesAhead,
            convertRefusalReasons,
            header.IsDefault);
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

    /// <param name="ordinal">
    /// 1-based position of this leg in the request's Linehauls array, used as
    /// the LegOrder fallback when the caller did not send one explicitly.
    /// </param>
    private static TblBulkScheduleLinehaul MapLinehaulToEntity(ScheduleLinehaulUpsertRequest l, int ordinal) =>
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
            LegOrder = l.LegOrder ?? ordinal,
            ChargePerConsignment = l.ChargePerConsignment,
        };

    private static TimeSpan ParseTime(string hhmm)
    {
        if (TimeSpan.TryParse(hhmm, out var ts)) return ts;
        throw new InvalidOperationException($"Invalid time format: '{hhmm}'. Use HH:mm.");
    }

    /// <summary>F11 Phase C (2026-09-24). Parse a nullable HH:mm string
    /// into a TimeSpan?. Mirrors ScheduleOverrideService.ParseNullableTime
    /// so the cutoff-time write path is consistent across services.</summary>
    private static TimeSpan? ParseNullableTime(string hhmm)
    {
        if (string.IsNullOrWhiteSpace(hhmm)) return null;
        return TimeSpan.TryParse(hhmm, out var ts) ? ts : (TimeSpan?)null;
    }

    /// <summary>F11 Phase C (2026-09-24). Derive the legacy CutoffHours
    /// integer offset from the absolute pair so downstream consumers that
    /// still read the old column (the Schedules NEW list card's
    /// MonCutoffHours/OtherCutoffHours, legacy tenant SPs not yet on
    /// Phase B) keep working. Mirrors the adhoc back-fill script:
    /// Absolute = midnight + StartTime - CutoffHours, so
    /// CutoffHours = StartTime - (dayOffset * 24 + CutoffTime).
    /// Returns 0 when the absolute pair is unset - the row is a legacy
    /// row and CutoffHours is whatever the caller passes in.</summary>
    private static int DeriveLegacyCutoffHours(byte? cutoffDay, TimeSpan? cutoffTime, short? dayOfWeek, TimeSpan? startTime)
    {
        if (!cutoffDay.HasValue || !cutoffTime.HasValue || !dayOfWeek.HasValue || !startTime.HasValue)
        {
            return 0;
        }
        // Day offset: 0 for same-day, -1 for one day prior, wrapping back
        // to -6. Matches fnScheduleForClient's day-offset math.
        int dayOffset = ((cutoffDay.Value - dayOfWeek.Value + 6) % 7) - 6;
        var baselineHours = startTime.Value.TotalHours;
        var cutoffMomentHours = (dayOffset * 24.0) + cutoffTime.Value.TotalHours;
        var offsetHours = baselineHours - cutoffMomentHours;
        return (int)Math.Round(offsetHours);
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
        await RefreshListSummaryEntryAsync(scheduleId);
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

        // Spec 6.1 rule 3, same test as the upsert path. This endpoint can
        // empty the link set outright, which on a non-default schedule leaves
        // it bookable by nobody.
        if (!header.IsDefault && desired.Count == 0 && !header.LegacyClientId.HasValue)
            throw new InvalidOperationException(
                "A schedule for specific clients needs at least one client. "
                + "Keep a client, or set the schedule to all clients first.");

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
        await RefreshListSummaryEntryAsync(scheduleId);

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

        // Spec 6.1 rule 3. Removing the LAST client from a schedule that is
        // not a default leaves it bookable by nobody, and this endpoint is the
        // easiest way to reach that state: the Clients tab's Remove button
        // goes straight here without passing through the upsert guard.
        var header = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .FirstOrDefaultAsync(h => h.ScheduleId == scheduleId);
        if (header != null && !header.IsDefault && !header.LegacyClientId.HasValue)
        {
            var remaining = await Context.ScheduleClients.AsNoTracking()
                .CountAsync(sc => sc.ScheduleId == scheduleId && sc.ClientId != clientId);
            if (remaining == 0)
                throw new InvalidOperationException(
                    "This is the only client on a schedule for specific clients. "
                    + "Set the schedule to all clients first, or configure another "
                    + "client before removing this one.");
        }

        Context.ScheduleClients.Remove(row);
        await Context.SaveChangesAsync();
        await RefreshListSummaryEntryAsync(scheduleId);
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
    /// <param name="linkExistingClients">When true, every client already on the
    /// bundle (linked to at least one non-default member) is also linked to
    /// each newly added non-default member, so the bundle stays whole
    /// (SCHEDULE-BUNDLES-UI-2026-10-16 section 4). Idempotent.</param>
    public async Task<int> AddBundleMembersAsync(int bundleId, IEnumerable<int> scheduleIds, bool linkExistingClients = false)
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

        // Clients on the bundle BEFORE the new members join: anyone linked to
        // an existing non-default member. Read first so the new members do
        // not count themselves.
        var clientsOnBundle = new List<int>();
        if (linkExistingClients)
        {
            var existingMemberIds = await Context.BulkRunScheduleBundleMembers.AsNoTracking()
                .Where(m => m.BundleId == bundleId)
                .Select(m => m.ScheduleId)
                .ToListAsync();
            var existingNonDefault = await Context.BulkRunScheduleHeaders.AsNoTracking()
                .Where(h => existingMemberIds.Contains(h.ScheduleId) && h.RetiredUtc == null && !h.IsDefault)
                .Select(h => h.ScheduleId)
                .ToListAsync();
            if (existingNonDefault.Count > 0)
                clientsOnBundle = await Context.ScheduleClients.AsNoTracking()
                    .Where(sc => existingNonDefault.Contains(sc.ScheduleId))
                    .Select(sc => sc.ClientId)
                    .Distinct()
                    .ToListAsync();
        }

        Context.BulkRunScheduleBundleMembers.AddRange(toAdd);

        if (clientsOnBundle.Count > 0)
        {
            var newIds = toAdd.Select(m => m.ScheduleId).ToList();
            var newNonDefault = await Context.BulkRunScheduleHeaders.AsNoTracking()
                .Where(h => newIds.Contains(h.ScheduleId) && !h.IsDefault)
                .Select(h => h.ScheduleId)
                .ToListAsync();
            var alreadyLinked = await Context.ScheduleClients.AsNoTracking()
                .Where(sc => newNonDefault.Contains(sc.ScheduleId) && clientsOnBundle.Contains(sc.ClientId))
                .Select(sc => new { sc.ScheduleId, sc.ClientId })
                .ToListAsync();
            var linkedSet = new HashSet<(int, int)>(alreadyLinked.Select(x => (x.ScheduleId, x.ClientId)));
            var now = DateTime.UtcNow;
            foreach (var sid in newNonDefault)
                foreach (var cid in clientsOnBundle)
                    if (!linkedSet.Contains((sid, cid)))
                        Context.ScheduleClients.Add(new ScheduleClient
                        {
                            ScheduleId = sid,
                            ClientId = cid,
                            CreatedUtc = now,
                            CreatedBy = $"RoutedOps:bundle-member-link:{bundleId}",
                        });
        }

        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
        return toAdd.Count;
    }

    /// <summary>
    /// One bundle with its live members and the clients linked to them,
    /// for the bundle modal (SCHEDULE-BUNDLES-UI-2026-10-16 section 4).
    /// A client is "on the bundle" when it has a link row on at least one
    /// non-default live member; OnMembers / OfMembers carry the coverage.
    /// </summary>
    public async Task<ScheduleBundleDetailDto> GetBundleDetailAsync(int bundleId)
    {
        var bundle = await Context.BulkRunScheduleBundles.AsNoTracking()
            .FirstOrDefaultAsync(b => b.BundleId == bundleId)
            ?? throw new InvalidOperationException($"Bundle {bundleId} not found.");

        var memberIds = await Context.BulkRunScheduleBundleMembers.AsNoTracking()
            .Where(m => m.BundleId == bundleId)
            .Select(m => m.ScheduleId)
            .ToListAsync();

        var headers = memberIds.Count == 0
            ? new List<BulkRunScheduleHeader>()
            : await Context.BulkRunScheduleHeaders.AsNoTracking()
                .Where(h => memberIds.Contains(h.ScheduleId) && h.RetiredUtc == null)
                .OrderBy(h => h.Name)
                .ToListAsync();

        var nonDefaultIds = headers.Where(h => !h.IsDefault).Select(h => h.ScheduleId).ToList();
        var links = nonDefaultIds.Count == 0
            ? new List<ScheduleClient>()
            : await Context.ScheduleClients.AsNoTracking()
                .Where(sc => nonDefaultIds.Contains(sc.ScheduleId))
                .ToListAsync();

        var linksBySchedule = links.GroupBy(l => l.ScheduleId).ToDictionary(g => g.Key, g => g.Count());

        // Depot / speed / days come from the day rows (tblBulkRunSchedule view),
        // the same source the Schedules tab summary uses.
        var liveIds = headers.Select(h => h.ScheduleId).ToList();
        var dayRows = liveIds.Count == 0
            ? new List<TblBulkRunSchedule>()
            : await Context.TblBulkRunSchedules.AsNoTracking()
                .Where(r => liveIds.Contains(r.ScheduleId))
                .ToListAsync();
        var depotNames = await Context.TblBulkRegions.AsNoTracking()
            .ToDictionaryAsync(r => r.BulkRegionId, r => r.Name);
        var speedNames = await Context.TucJobTypes.AsNoTracking()
            .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);
        var rowsBySchedule = dayRows.GroupBy(r => r.ScheduleId).ToDictionary(g => g.Key, g => g.ToList());

        var members = headers
            .Select(h =>
            {
                rowsBySchedule.TryGetValue(h.ScheduleId, out var rows);
                var first = rows?.OrderBy(r => r.DayOfWeek).FirstOrDefault();
                string LookupDepot(int? id) => id.HasValue && depotNames.TryGetValue(id.Value, out var d) ? d : null;
                string LookupSpeed(int? id) => id.HasValue && speedNames.TryGetValue(id.Value, out var sp) ? sp : null;
                var days = rows == null
                    ? Array.Empty<int>()
                    : rows.Where(r => r.DayOfWeek.HasValue).Select(r => (int)r.DayOfWeek.Value).Distinct().OrderBy(d => d).ToArray();
                return new ScheduleBundleMemberDto(
                    h.ScheduleId, h.Name, h.IsDefault,
                    linksBySchedule.TryGetValue(h.ScheduleId, out var n) ? n : 0,
                    LookupDepot(first?.Region), LookupSpeed(first?.SpeedId), days);
            })
            .ToList();

        var clientIds = links.Select(l => l.ClientId).Distinct().ToList();
        var clientLookup = clientIds.Count == 0
            ? new List<TucClientNameCode>()
            : await Context.TucClients.AsNoTracking()
                .Where(c => clientIds.Contains(c.UcclId))
                .Select(c => new TucClientNameCode { Id = c.UcclId, Code = c.UcclCode, Name = c.UcclName })
                .ToListAsync();
        var byId = clientLookup.ToDictionary(c => c.Id);
        var clients = links
            .GroupBy(l => l.ClientId)
            .Select(g => new ScheduleBundleClientDto(
                g.Key,
                byId.TryGetValue(g.Key, out var c) && !string.IsNullOrWhiteSpace(c.Code) ? c.Code : $"#{g.Key}",
                byId.TryGetValue(g.Key, out var c2) ? c2.Name : null,
                g.Select(l => l.ScheduleId).Distinct().Count(),
                nonDefaultIds.Count))
            .OrderByDescending(c => c.OnMembers)
            .ThenBy(c => c.Code)
            .ToList();

        return new ScheduleBundleDetailDto(
            bundle.BundleId, bundle.Name, bundle.Description, bundle.IsActive, members, clients);
    }

    /// <summary>
    /// Remove one client from every member of a bundle. Deletes the
    /// tblScheduleClient rows only, the same as DetachClientAsync does for a
    /// single schedule, so the two paths stay consistent. Returns rows removed.
    /// </summary>
    public async Task<int> DetachClientFromBundleAsync(int bundleId, int clientId)
    {
        if (clientId <= 0) return 0;
        var memberIds = await Context.BulkRunScheduleBundleMembers.AsNoTracking()
            .Where(m => m.BundleId == bundleId)
            .Select(m => m.ScheduleId)
            .ToListAsync();
        if (memberIds.Count == 0) return 0;

        var rows = await Context.ScheduleClients
            .Where(sc => memberIds.Contains(sc.ScheduleId) && sc.ClientId == clientId)
            .ToListAsync();
        if (rows.Count == 0) return 0;
        Context.ScheduleClients.RemoveRange(rows);
        await Context.SaveChangesAsync();
        InvalidateListSummaryCache();
        return rows.Count;
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

    /// <summary>Snapshot of a schedule's base values used to diff each
    /// override row (Steve nested-override brief 2026-09-24). The
    /// projection carries only the fields BuildOverrideRows consumes -
    /// keeps the helper signature stable if the row projection grows
    /// later.</summary>
    private readonly record struct OverrideBaseSnapshot(
        byte? CutoffDay,
        TimeSpan? CutoffTime,
        TimeSpan? StartTime,
        TimeSpan? EndTime,
        int? PickupDepotId,
        int? PickupRatingSpeed,
        int? PickupPostcodeGroupId,
        int? DeliverySpeedId,
        int? DeliveryPostcodeGroupId);

    private static readonly string[] DayNames = { "", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" };

    /// <summary>
    /// Build one <see cref="ScheduleOverrideRowDto"/> per client that owns
    /// any delta row on a schedule (Steve nested-override brief 2026-09-24).
    /// Each row's DeltaLabels array carries a human-readable label per
    /// scope+field diff so operators can see what the client differs on
    /// without opening the editor. Rows with no meaningful diff labels
    /// are skipped so the list view stays tidy.
    /// </summary>
    private static List<ScheduleOverrideRowDto> BuildOverrideRows(
        List<BulkRunScheduleOverride> rows,
        BulkRunScheduleHeader header,
        OverrideBaseSnapshot baseSnap,
        int[] activeDays,
        IReadOnlyDictionary<int, string> clientCodes,
        IReadOnlyDictionary<int, string> clientNames,
        IReadOnlyDictionary<int, string> speedNames,
        IReadOnlyDictionary<int, string> postcodeGroupNames,
        IReadOnlyDictionary<int, string> depotNames)
    {
        var results = new List<ScheduleOverrideRowDto>();
        foreach (var g in rows.GroupBy(r => r.ClientId).OrderBy(g => clientCodes.TryGetValue(g.Key, out var cc) ? cc : $"#{g.Key}", StringComparer.OrdinalIgnoreCase))
        {
            var labels = new List<string>();
            foreach (var row in g)
            {
                switch (row.Scope)
                {
                    case BulkRunScheduleOverride.ScopeSchedule:
                        AddScheduleScopeLabels(labels, row, header, baseSnap, activeDays);
                        break;
                    case BulkRunScheduleOverride.ScopeCollection:
                        AddLegScopeLabels(labels, row,
                            baseSpeedId: baseSnap.PickupRatingSpeed,
                            baseZoneGroupId: baseSnap.PickupPostcodeGroupId,
                            baseWindowStart: baseSnap.StartTime,
                            baseWindowEnd: baseSnap.EndTime,
                            legLabel: "Pickup",
                            speedNames: speedNames,
                            groupNames: postcodeGroupNames);
                        break;
                    case BulkRunScheduleOverride.ScopeDelivery:
                        AddLegScopeLabels(labels, row,
                            baseSpeedId: baseSnap.DeliverySpeedId,
                            baseZoneGroupId: baseSnap.DeliveryPostcodeGroupId,
                            baseWindowStart: null,
                            baseWindowEnd: null,
                            legLabel: "Delivery",
                            speedNames: speedNames,
                            groupNames: postcodeGroupNames);
                        break;
                    case BulkRunScheduleOverride.ScopeDepot:
                        // Depot scope is reserved by the delta table but has
                        // no dedicated column today. The brief still asks
                        // for a "Depot X (base Y)" label - reuse the leg
                        // SpeedId slot as a placeholder for now; when the
                        // depot column ships this branch swaps to that.
                        if (row.SpeedId.HasValue && row.SpeedId != baseSnap.PickupDepotId)
                        {
                            var newName = depotNames.TryGetValue(row.SpeedId.Value, out var nn) ? nn : $"#{row.SpeedId.Value}";
                            var baseName = baseSnap.PickupDepotId.HasValue && depotNames.TryGetValue(baseSnap.PickupDepotId.Value, out var bn) ? bn : "-";
                            labels.Add($"Depot {newName} (base {baseName})");
                        }
                        break;
                }
            }
            if (labels.Count == 0)
            {
                // No meaningful scoped diff. Per Steve, skip so the list
                // view does not carry noise rows.
                continue;
            }
            var code = clientCodes.TryGetValue(g.Key, out var cCode) ? cCode : null;
            var name = clientNames.TryGetValue(g.Key, out var cName) ? cName : null;
            results.Add(new ScheduleOverrideRowDto(g.Key, code, name, labels.ToArray()));
        }
        return results;
    }

    private static void AddScheduleScopeLabels(
        List<string> labels,
        BulkRunScheduleOverride row,
        BulkRunScheduleHeader header,
        OverrideBaseSnapshot baseSnap,
        int[] activeDays)
    {
        // Cut-off pair diff. Show whenever either component differs; we
        // format the shown value as "<Day> HH:mm" even when only one half
        // moved so operators see the full new state alongside the base.
        var overrideCutoffDay = row.CutoffDay;
        var overrideCutoffTime = row.CutoffTime;
        var basePairSet = baseSnap.CutoffDay.HasValue || baseSnap.CutoffTime.HasValue;
        var overridePairSet = overrideCutoffDay.HasValue || overrideCutoffTime.HasValue;
        if (overridePairSet
            && (overrideCutoffDay != baseSnap.CutoffDay || overrideCutoffTime != baseSnap.CutoffTime))
        {
            var newLabel = FormatDayTime(overrideCutoffDay, overrideCutoffTime);
            var baseLabel = basePairSet
                ? FormatDayTime(baseSnap.CutoffDay, baseSnap.CutoffTime)
                : "-";
            labels.Add($"Cut-off {newLabel} (base {baseLabel})");
        }

        // WeekDays: override stores a 7-char mask, base derives from
        // activeDays (1=Mon..7=Sun).
        if (!string.IsNullOrEmpty(row.WeekDays))
        {
            var baseMask = ActiveDaysToMask(activeDays);
            if (!string.Equals(row.WeekDays, baseMask, StringComparison.Ordinal))
            {
                labels.Add($"Days {row.WeekDays} (base {baseMask})");
            }
        }

        if (!string.IsNullOrEmpty(row.DisplayName)
            && !string.Equals(row.DisplayName, header.DisplayName, StringComparison.Ordinal))
        {
            var baseLabel = string.IsNullOrEmpty(header.DisplayName) ? header.Name : header.DisplayName;
            labels.Add($"Display name {row.DisplayName} (base {baseLabel})");
        }

        if (!string.IsNullOrEmpty(row.DisplayDescription)
            && !string.Equals(row.DisplayDescription, header.DisplayDescription, StringComparison.Ordinal))
        {
            // Long-text: avoid dumping full description text into the
            // hint. Just note that the copy is overridden.
            labels.Add("Display description overridden");
        }

        if (row.IsActive.HasValue && row.IsActive.Value != header.IsActive)
        {
            var newLabel = row.IsActive.Value ? "true" : "false";
            var baseLabel = header.IsActive ? "true" : "false";
            labels.Add($"Active {newLabel} (base {baseLabel})");
        }
    }

    private static void AddLegScopeLabels(
        List<string> labels,
        BulkRunScheduleOverride row,
        int? baseSpeedId,
        int? baseZoneGroupId,
        TimeSpan? baseWindowStart,
        TimeSpan? baseWindowEnd,
        string legLabel,
        IReadOnlyDictionary<int, string> speedNames,
        IReadOnlyDictionary<int, string> groupNames)
    {
        if (row.SpeedId.HasValue && row.SpeedId != baseSpeedId)
        {
            var newName = speedNames.TryGetValue(row.SpeedId.Value, out var nn) ? nn : $"#{row.SpeedId.Value}";
            var baseName = baseSpeedId.HasValue && speedNames.TryGetValue(baseSpeedId.Value, out var bn) ? bn : "-";
            labels.Add($"{legLabel} speed {newName} (base {baseName})");
        }
        if (row.ZoneGroupId.HasValue && row.ZoneGroupId != baseZoneGroupId)
        {
            var newName = groupNames.TryGetValue(row.ZoneGroupId.Value, out var nn) ? nn : $"#{row.ZoneGroupId.Value}";
            var baseName = baseZoneGroupId.HasValue && groupNames.TryGetValue(baseZoneGroupId.Value, out var bn) ? bn : "-";
            labels.Add($"{legLabel} zone group {newName} (base {baseName})");
        }
        if (!string.IsNullOrEmpty(row.PickupTimeMode))
        {
            // Base has no PickupTimeMode column so any override value is
            // itself a delta from the implicit default.
            labels.Add($"{legLabel} mode {row.PickupTimeMode} (base -)");
        }
        if (row.PickupWindowStart.HasValue || row.PickupWindowEnd.HasValue)
        {
            var newStart = FormatTimeOrDash(row.PickupWindowStart);
            var newEnd = FormatTimeOrDash(row.PickupWindowEnd);
            var baseStart = FormatTimeOrDash(baseWindowStart);
            var baseEnd = FormatTimeOrDash(baseWindowEnd);
            if (row.PickupWindowStart != baseWindowStart || row.PickupWindowEnd != baseWindowEnd)
            {
                labels.Add($"{legLabel} window {newStart}-{newEnd} (base {baseStart}-{baseEnd})");
            }
        }
    }

    private static string ActiveDaysToMask(int[] activeDays)
    {
        var buf = new char[7];
        for (var i = 0; i < 7; i++) buf[i] = '0';
        foreach (var d in activeDays)
        {
            if (d >= 1 && d <= 7) buf[d - 1] = '1';
        }
        return new string(buf);
    }

    private static string FormatDayTime(byte? day, TimeSpan? time)
    {
        var dayLabel = day.HasValue && day.Value >= 1 && day.Value <= 7 ? DayNames[day.Value] : "-";
        var timeLabel = time.HasValue ? time.Value.ToString(@"hh\:mm") : "-";
        return $"{dayLabel} {timeLabel}";
    }

    private static string FormatTimeOrDash(TimeSpan? time)
        => time.HasValue ? time.Value.ToString(@"hh\:mm") : "-";
}
