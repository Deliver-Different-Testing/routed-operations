using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutedOperations.Core.Application.Dtos.Schedule;
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
    ILogger<ScheduleService> logger)
    : BaseService(contextFactory)
{
    private readonly ILogger<ScheduleService> _logger = logger;

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
        var depotNames = await Context.TblBulkRegions.AsNoTracking()
            .ToDictionaryAsync(r => r.BulkRegionId, r => r.Name);
        var speedNames = await Context.TucJobTypes.AsNoTracking()
            .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);

        // Live headers (RetiredUtc filter excludes soft-deleted schedules).
        var headers = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => h.RetiredUtc == null)
            .ToListAsync();
        var headersById = headers.ToDictionary(h => h.ScheduleId);
        var liveHeaderIds = new HashSet<int>(headers.Select(h => h.ScheduleId));

        // Link rows scoped to live headers. Group by ScheduleId so
        // we can look up "clients bound to this header" in O(1).
        var linkRows = await Context.ScheduleClients.AsNoTracking()
            .Where(sc => liveHeaderIds.Contains(sc.ScheduleId))
            .Select(x => new { x.ScheduleId, x.ClientId })
            .ToListAsync();
        var linkClientsByHeaderId = linkRows
            .GroupBy(x => x.ScheduleId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ClientId).ToHashSet());

        // Postcode + polygon still keyed on ScheduleName (out of scope).
        var postcodeCountByName = await Context.SchedulePostcodes.AsNoTracking()
            .GroupBy(x => x.ScheduleName)
            .Select(g => new { Name = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Name, x => x.Count);
        var polygonCountByName = await Context.SchedulePolygons.AsNoTracking()
            .GroupBy(x => x.ScheduleName)
            .Select(g => new { Name = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Name, x => x.Count);

        // Day rows for live headers only. Projection-only, no Includes.
        var rowBases = await Context.TblBulkRunSchedules.AsNoTracking()
            .Where(s => liveHeaderIds.Contains(s.ScheduleId))
            .Select(s => new
            {
                s.BulkRunScheduleId,
                s.ScheduleId,
                s.Name,
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

        var allScheduleIds = rowBases.Select(r => r.BulkRunScheduleId).ToHashSet();

        // NOTE on scale: previously used `.Where(z => allScheduleIds.Contains(z.ScheduleId))`
        // which EF Core translates as `WHERE Id IN (@p1..@pN)`. On a tenant with 2000+
        // schedules that expands past SQL Server's 2100-parameter limit and the query
        // either crashes or plans a monster IN list that runs for minutes. Fetch the
        // whole (small) table and filter in memory instead - way faster overall.
        var zoneCountByScheduleId = (await Context.BulkZoneSchedules.AsNoTracking()
            .Where(z => z.Active == true && z.ScheduleId.HasValue)
            .Select(z => new { ScheduleId = z.ScheduleId!.Value })
            .ToListAsync())
            .Where(z => allScheduleIds.Contains(z.ScheduleId))
            .GroupBy(z => z.ScheduleId)
            .ToDictionary(g => g.Key, g => g.Count());

        var activeLinehaulLegs = (await Context.TblBulkScheduleLinehauls.AsNoTracking()
            .Where(l => l.Active == true && l.BulkRunScheduleId.HasValue)
            .Select(l => new { l.BulkRunScheduleId, l.LinehaulRunId })
            .ToListAsync())
            .Where(l => allScheduleIds.Contains(l.BulkRunScheduleId!.Value))
            .ToList();
        var scheduleIdsWithActiveLinehaul = activeLinehaulLegs
            .Select(l => l.BulkRunScheduleId!.Value)
            .Distinct()
            .ToHashSet();

        // Linehaul run info for the compact "LH AUC-CHR 21:30" chip in
        // the Roster column. Fetched only for runs actually referenced
        // by a live schedule's linehaul legs to keep the payload small.
        var referencedRunIds = activeLinehaulLegs
            .Where(l => l.LinehaulRunId.HasValue)
            .Select(l => l.LinehaulRunId!.Value)
            .Distinct()
            .ToList();
        var linehaulRuns = referencedRunIds.Count == 0
            ? new Dictionary<int, (int FromDepotId, int ToDepotId, TimeOnly? StartTime)>()
            : (await Context.TblbulkLinehaulRuns.AsNoTracking()
                .Where(r => referencedRunIds.Contains(r.Id))
                .Select(r => new { r.Id, r.FromDepotId, r.ToDepotId, r.StartTime })
                .ToListAsync())
                .ToDictionary(r => r.Id, r => (r.FromDepotId, r.ToDepotId, r.StartTime));

        // Recurring routes bound to any day row of a header. Junction
        // "ScheduleId" here means the day-row BulkRunScheduleId - legacy
        // naming from before the 2026-09-08 rename. We fold to header
        // and count distinct RouteIds.
        var dayRowToHeader = rowBases.ToDictionary(r => r.BulkRunScheduleId, r => r.ScheduleId);
        // Same story as zoneCountByScheduleId + activeLinehaulLegs above:
        // the WHERE ... IN (@p1..@pN) blows the SQL parameter cap on
        // tenants with >2000 schedules. Fetch the whole (small)
        // junction and filter client-side.
        var routeJunctionRows = (await Context.Set<Dictionary<string, object>>("RouteSchedule")
            .Select(rs => new
            {
                RouteId = EF.Property<int>(rs, "RouteId"),
                BulkRunScheduleId = EF.Property<int>(rs, "ScheduleId"),
            })
            .ToListAsync())
            .Where(rs => allScheduleIds.Contains(rs.BulkRunScheduleId))
            .ToList();
        var routeCountByHeaderId = routeJunctionRows
            .GroupBy(rs => dayRowToHeader.TryGetValue(rs.BulkRunScheduleId, out var h) ? h : 0)
            .Where(g => g.Key != 0)
            .ToDictionary(g => g.Key, g => g.Select(rs => rs.RouteId).Distinct().Count());

        // Override count per base header. Steve's mockup renders "+N"
        // next to a base schedule's Name when N overrides exist.
        var overrideCountByBaseId = headers
            .Where(h => h.BaseScheduleId.HasValue && liveHeaderIds.Contains(h.BaseScheduleId.Value))
            .GroupBy(h => h.BaseScheduleId!.Value)
            .ToDictionary(g => g.Key, g => g.Count());

        var legacyClientIds = headers
            .Where(h => h.LegacyClientId.HasValue)
            .Select(h => h.LegacyClientId!.Value)
            .Distinct()
            .ToList();
        var legacyClientCodes = legacyClientIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucClients.AsNoTracking()
                .Where(c => legacyClientIds.Contains(c.UcclId) && c.UcclCode != null)
                .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);

        // Client-code lookup for the LinkedClientCodes chip strip. Covers
        // every client that appears in any live header's link set (union of
        // linkClientsByHeaderId values) plus the legacy client ids so the
        // dictionary is complete for both display paths.
        var allLinkedClientIds = linkClientsByHeaderId.Values
            .SelectMany(s => s)
            .Concat(legacyClientIds)
            .Distinct()
            .ToList();
        var clientCodes = allLinkedClientIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucClients.AsNoTracking()
                .Where(c => allLinkedClientIds.Contains(c.UcclId) && c.UcclCode != null)
                .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);

        // Base-template lookup for override rows. Steve's brief §2 says
        // an override row must render "differs on: <field list>". We
        // diff the override's own template (region / origin depot / speed
        // / window / Monday cutoff / other cutoff / active days) against
        // its base's template and emit the field names that differ.
        var templateByHeaderId = rowBases
            .GroupBy(r => r.ScheduleId)
            .Where(g => headersById.ContainsKey(g.Key))
            .ToDictionary(g => g.Key, g =>
            {
                var first = g.First();
                var starts = g.Where(x => x.StartTime.HasValue).Select(x => x.StartTime!.Value).ToArray();
                var ends = g.Where(x => x.EndTime.HasValue).Select(x => x.EndTime!.Value).ToArray();
                var days = g.Select(x => (int)(x.DayOfWeek ?? 0))
                    .Where(d => d > 0).Distinct().OrderBy(d => d).ToArray();
                var monRow = g.FirstOrDefault(x => x.DayOfWeek == 1);
                var otherCutoffs = g
                    .Where(x => x.DayOfWeek != 1 && x.DayOfWeek.HasValue)
                    .Select(x => (int?)x.CutoffHours)
                    .ToArray();
                int? otherC = otherCutoffs.Length == 0
                    ? null
                    : otherCutoffs.GroupBy(v => v).OrderByDescending(gg => gg.Count()).First().Key;
                return new
                {
                    RegionId = first.Region,
                    PickupDepotId = g.FirstOrDefault(x => x.PickupDepotId.HasValue)?.PickupDepotId,
                    SpeedId = first.SpeedId,
                    WindowStart = starts.Length > 0 ? starts.Min().ToString(@"hh\:mm") : null,
                    WindowEnd = ends.Length > 0 ? ends.Max().ToString(@"hh\:mm") : null,
                    MonCutoff = monRow?.CutoffHours,
                    OtherCutoff = otherC,
                    ActiveDays = days,
                };
            });

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
                    .Select(x => zoneCountByScheduleId.TryGetValue(x.BulkRunScheduleId, out var c) ? c : 0)
                    .DefaultIfEmpty(0).Max();
                var hasLh = g.Any(x => scheduleIdsWithActiveLinehaul.Contains(x.BulkRunScheduleId));

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

                var overrideCount = overrideCountByBaseId.TryGetValue(header.ScheduleId, out var oc) ? oc : 0;
                var routeCount = routeCountByHeaderId.TryGetValue(header.ScheduleId, out var rc) ? rc : 0;

                // Linehaul hint: first active linehaul leg's run, in
                // Steve's "LH AUC-CHR 21:30" compact form. Depot codes
                // are the first 3 letters of the depot name, upper-
                // cased - matches the tenant's own convention where
                // depot names are already short single words.
                string linehaulHint = null;
                var firstLhLeg = activeLinehaulLegs
                    .FirstOrDefault(l => l.LinehaulRunId.HasValue && l.BulkRunScheduleId.HasValue
                        && g.Any(x => x.BulkRunScheduleId == l.BulkRunScheduleId!.Value));
                if (firstLhLeg?.LinehaulRunId is int runId
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

                // Compute overriddenFields when this row is an override
                // (has a BaseScheduleId that points to a live header we
                // have a template for). Compare field-by-field against the
                // base's template using the operator's own labels so the
                // hint reads naturally: "differs on: Cut-off, Speed".
                string[] overriddenFields = Array.Empty<string>();
                if (header.BaseScheduleId.HasValue
                    && templateByHeaderId.TryGetValue(header.BaseScheduleId.Value, out var baseTpl))
                {
                    var diffs = new List<string>();
                    if (first.Region != baseTpl.RegionId) diffs.Add("Destination depot");
                    if ((g.FirstOrDefault(x => x.PickupDepotId.HasValue)?.PickupDepotId) != baseTpl.PickupDepotId) diffs.Add("Origin depot");
                    if (first.SpeedId != baseTpl.SpeedId) diffs.Add("Speed");
                    if (windowStart != baseTpl.WindowStart || windowEnd != baseTpl.WindowEnd) diffs.Add("Window");
                    if (monCutoff != baseTpl.MonCutoff || otherCutoff != baseTpl.OtherCutoff) diffs.Add("Cut-off");
                    if (!activeDays.SequenceEqual(baseTpl.ActiveDays)) diffs.Add("Days");
                    overriddenFields = diffs.ToArray();
                }

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
                    overriddenFields);
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
    /// Read-only list of schedule bundles (Dane's Schedule Groups).
    /// Aggregates member schedule count + total unique clients bound
    /// across the members' link rows. Only surfaces active groups
    /// (IsActive = 1). Sorted alphabetically by name for a stable
    /// browse experience.
    ///
    /// Ships empty until the 20260914140000 migration applies (the
    /// tblBulkRunScheduleGroup + tblBulkRunScheduleGroupMember tables
    /// don't exist pre-migration). EF Core handles the empty DbSet
    /// gracefully; no code branch needed.
    /// </summary>
    public async Task<List<ScheduleGroupBundleDto>> ListScheduleGroupsAsync()
    {
        // OrderBy with a StringComparer cannot translate to SQL - EF Core
        // throws `The LINQ expression ... could not be translated`. Fetch
        // the rows first, then sort with the case-insensitive ordinal
        // comparer client-side. Matches the pattern already used at the
        // end of ListSummaryAsync (line ~229) and by every other .OrderBy
        // (StringComparer) call in this service.
        var groups = (await Context.BulkRunScheduleGroups.AsNoTracking()
            .Where(g => g.IsActive)
            .ToListAsync())
            .OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (groups.Count == 0) return new List<ScheduleGroupBundleDto>();

        var groupIds = groups.Select(g => g.GroupId).ToList();
        var memberRows = await Context.BulkRunScheduleGroupMembers.AsNoTracking()
            .Where(m => groupIds.Contains(m.GroupId))
            .ToListAsync();
        var scheduleIds = memberRows.Select(m => m.ScheduleId).Distinct().ToList();

        var headers = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => scheduleIds.Contains(h.ScheduleId) && h.RetiredUtc == null)
            .ToListAsync();
        var headersById = headers.ToDictionary(h => h.ScheduleId);

        // Client count = union of link rows across every non-default
        // member. Default headers do not carry link rows so they add
        // zero to the client count, matching Steve's brief section 2
        // Schedule Groups tab semantics ("Attach clients to group -
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
        var membersByGroup = memberRows.GroupBy(m => m.GroupId)
            .ToDictionary(g => g.Key, g => g.Select(m => m.ScheduleId).ToArray());

        return groups.Select(g =>
        {
            var members = membersByGroup.TryGetValue(g.GroupId, out var ms) ? ms : Array.Empty<int>();
            var liveMembers = members.Where(id => headersById.ContainsKey(id)).ToArray();
            var uniqueClients = liveMembers
                .Where(id => nonDefaultMemberIds.Contains(id))
                .SelectMany(id => linkRows.Where(l => l.ScheduleId == id).Select(l => l.ClientId))
                .Distinct()
                .Count();
            var names = liveMembers
                .Select(id => headersById.TryGetValue(id, out var h) ? h.Name : $"#{id}")
                .ToArray();
            return new ScheduleGroupBundleDto(
                g.GroupId, g.Name, g.Description, g.IsActive,
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

        var storageStates = new List<StateOptionDto>
        {
            new(0, "None"), new(1, "Frozen"), new(2, "Chilled"), new(3, "Ambient"),
        };
        var deliveryStates = new List<StateOptionDto>
        {
            new(0, "None"), new(1, "Frozen"), new(2, "Chilled"), new(3, "Ambient"),
        };
        var pickupBoxDiscounts = new List<StateOptionDto>
        {
            new(0, "None"), new(1, "10%"), new(2, "20%"), new(3, "30%"),
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
        if (req.ScheduleId.HasValue && req.ScheduleId.Value > 0)
        {
            header = await Context.BulkRunScheduleHeaders
                .FirstOrDefaultAsync(h => h.ScheduleId == req.ScheduleId.Value && h.RetiredUtc == null)
                ?? throw new InvalidOperationException($"Schedule id {req.ScheduleId.Value} not found or retired.");
            if (!string.Equals(header.Name, name, StringComparison.Ordinal))
                header.Name = name;
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
        foreach (var row in existing)
        {
            Context.BulkZoneSchedules.RemoveRange(row.BulkZoneSchedules);
            Context.TblBulkScheduleLinehauls.RemoveRange(row.TblBulkScheduleLinehauls);
            foreach (var z in req.Zones ?? Enumerable.Empty<ScheduleZoneUpsertRequest>())
                row.BulkZoneSchedules.Add(new BulkZoneSchedule { Zone = z.Zone, Active = z.Active });
            foreach (var l in req.Linehauls ?? Enumerable.Empty<ScheduleLinehaulUpsertRequest>())
                row.TblBulkScheduleLinehauls.Add(MapLinehaulToEntity(l));
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
        return newValue;
    }

    /// <summary>Legacy (Name, LegacyClientId) overload. Hard-fails on
    /// ambiguity per Steve's 2026-09-09 regression review Finding 3.</summary>
    public async Task<bool> ToggleAutoBookAsync(string name, int? legacyClientId)
    {
        var header = await ResolveHeaderByTupleAsync(name, legacyClientId, asNoTracking: true);
        return await ToggleAutoBookAsync(header.ScheduleId);
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
            clientLinkedUtcs, clientNamesForGroup);
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
    /// Blocks attaching a client that has its own override of this base
    /// (Steve's brief section 5 "a client is on the base OR on one
    /// override, never both").
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

        // Block ids that own an override of this base (their link row
        // lives on the override, not the base).
        var overrideOwners = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => h.BaseScheduleId == scheduleId && h.RetiredUtc == null)
            .Select(h => h.ScheduleId)
            .ToListAsync();
        var overrideClientIds = new HashSet<int>();
        if (overrideOwners.Count > 0)
        {
            var list = await Context.ScheduleClients.AsNoTracking()
                .Where(sc => overrideOwners.Contains(sc.ScheduleId) && ids.Contains(sc.ClientId))
                .Select(sc => sc.ClientId)
                .ToListAsync();
            overrideClientIds = new HashSet<int>(list);
        }

        var now = DateTime.UtcNow;
        var toAdd = ids
            .Where(id => !already.Contains(id) && !overrideClientIds.Contains(id))
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
        return toAdd.Count;
    }

    /// <summary>
    /// Full replace of a schedule's link rows. Adds every id not already
    /// linked; removes every current link not in the new set. Skips
    /// clients that own an override of this base (Steve section 5).
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

            var overrideOwners = await Context.BulkRunScheduleHeaders.AsNoTracking()
                .Where(h => h.BaseScheduleId == scheduleId && h.RetiredUtc == null)
                .Select(h => h.ScheduleId)
                .ToListAsync();
            if (overrideOwners.Count > 0)
            {
                var blocked = await Context.ScheduleClients.AsNoTracking()
                    .Where(sc => overrideOwners.Contains(sc.ScheduleId) && desired.Contains(sc.ClientId))
                    .Select(sc => sc.ClientId)
                    .ToListAsync();
                if (blocked.Count > 0)
                    throw new InvalidOperationException(
                        $"Client id(s) {string.Join(", ", blocked)} own an override of this base and cannot be attached to the base as well.");
            }
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
        return 1;
    }

    /// <summary>
    /// Create an override header pointing at the base. Copies the base's
    /// day rows verbatim; the client's link row moves from the base to
    /// the override (Steve's brief section 5 invariant).
    /// </summary>
    public async Task<int> CreateOverrideAsync(int baseScheduleId, int clientId)
    {
        var baseHeader = await Context.BulkRunScheduleHeaders
            .FirstOrDefaultAsync(h => h.ScheduleId == baseScheduleId && h.RetiredUtc == null)
            ?? throw new InvalidOperationException($"Base schedule {baseScheduleId} not found or retired.");
        if (baseHeader.BaseScheduleId != null)
            throw new InvalidOperationException("Cannot create an override on top of an override. Pick the base schedule.");

        var alreadyOverrides = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => h.BaseScheduleId == baseScheduleId && h.RetiredUtc == null)
            .Select(h => h.ScheduleId)
            .ToListAsync();
        if (alreadyOverrides.Count > 0)
        {
            var owned = await Context.ScheduleClients.AsNoTracking()
                .AnyAsync(sc => alreadyOverrides.Contains(sc.ScheduleId) && sc.ClientId == clientId);
            if (owned)
                throw new InvalidOperationException(
                    $"Client {clientId} already owns an override of schedule {baseScheduleId}.");
        }

        // Fresh override header (BaseScheduleId set; IsDefault stays
        // false; LegacyClientId null - the link table owns the truth).
        var now = DateTime.UtcNow;
        var overrideHeader = new BulkRunScheduleHeader
        {
            Name = baseHeader.Name,
            IsDefault = false,
            LegacyClientId = null,
            BaseScheduleId = baseScheduleId,
            CreatedUtc = now,
            CreatedBy = "RoutedOps:override-create",
        };
        Context.BulkRunScheduleHeaders.Add(overrideHeader);
        await Context.SaveChangesAsync(); // realise the id

        // Clone the base's day rows (Include the same nav-heavy rows so
        // we get zones + linehauls too when the operator opens the edit
        // modal on the fresh override).
        var baseRows = await Context.TblBulkRunSchedules
            .Where(s => s.ScheduleId == baseScheduleId)
            .ToListAsync();
        foreach (var src in baseRows)
        {
            var copy = new TblBulkRunSchedule
            {
                ScheduleId = overrideHeader.ScheduleId,
                Name = src.Name,
                DayOfWeek = src.DayOfWeek,
                ClientId = src.ClientId,
                SpeedId = src.SpeedId,
                Region = src.Region,
                StartTime = src.StartTime,
                EndTime = src.EndTime,
                AutoBook = src.AutoBook,
                ApplyPickupCutoff = src.ApplyPickupCutoff,
                PickupCutoff = src.PickupCutoff,
                BookPickup = src.BookPickup,
                PickupDepotId = src.PickupDepotId,
                CutoffHours = src.CutoffHours,
                Description = src.Description,
                MaxJobs = src.MaxJobs,
                PickupRatingSpeed = src.PickupRatingSpeed,
                PickupPostcodeGroupId = src.PickupPostcodeGroupId,
                ParentSpeedId = src.ParentSpeedId,
                PickupBoxDiscount = src.PickupBoxDiscount,
                PostcodeGroupId = src.PostcodeGroupId,
                StorageState = src.StorageState,
                DeliveryState = src.DeliveryState,
                DropOffLocationId = src.DropOffLocationId,
            };
            Context.TblBulkRunSchedules.Add(copy);
        }

        // Move the client's link row from base to override. If the
        // client isn't on the base's link table (edge case - they were
        // relying on the default fallback), just create the link on the
        // override.
        var baseLink = await Context.ScheduleClients
            .FirstOrDefaultAsync(sc => sc.ScheduleId == baseScheduleId && sc.ClientId == clientId);
        if (baseLink != null) Context.ScheduleClients.Remove(baseLink);
        Context.ScheduleClients.Add(new ScheduleClient
        {
            ScheduleId = overrideHeader.ScheduleId,
            ClientId = clientId,
            CreatedUtc = now,
            CreatedBy = "RoutedOps:override-create",
        });

        await Context.SaveChangesAsync();
        return overrideHeader.ScheduleId;
    }

    /// <summary>
    /// List overrides of a base header + the client each override owns.
    /// Used by the AttachClientsModal's "has own override #id" hint so
    /// operators can see which candidate clients are unavailable to
    /// attach directly to the base.
    /// </summary>
    public async Task<List<OverrideRefDto>> ListOverridesAsync(int baseScheduleId)
    {
        var overrideHeaders = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => h.BaseScheduleId == baseScheduleId && h.RetiredUtc == null)
            .Select(h => new { h.ScheduleId, h.Name })
            .ToListAsync();
        if (overrideHeaders.Count == 0) return new List<OverrideRefDto>();

        var overrideIds = overrideHeaders.Select(o => o.ScheduleId).ToList();
        var links = await Context.ScheduleClients.AsNoTracking()
            .Where(sc => overrideIds.Contains(sc.ScheduleId))
            .Select(sc => new { sc.ScheduleId, sc.ClientId })
            .ToListAsync();

        var clientIds = links.Select(l => l.ClientId).Distinct().ToList();
        var codes = clientIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucClients.AsNoTracking()
                .Where(c => clientIds.Contains(c.UcclId) && c.UcclCode != null)
                .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);

        return links
            .Select(l => new OverrideRefDto(
                l.ScheduleId,
                l.ClientId,
                codes.TryGetValue(l.ClientId, out var code) ? code : null))
            .ToList();
    }

    // ─── Schedule Groups writes (Phase 4 per Steve's brief; Kevin
    // asked for these on 2026-09-15 to complete Phase 1 shipping) ──

    /// <summary>
    /// Create a new Schedule Group with an initial member list.
    /// Members are validated to exist as live headers. Groups are
    /// active by default; description is optional.
    /// </summary>
    public async Task<int> CreateGroupAsync(string name, string description, IEnumerable<int> scheduleIds)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Group name is required.");
        var trimmedName = name.Trim();
        if (await Context.BulkRunScheduleGroups.AsNoTracking().AnyAsync(g => g.Name == trimmedName))
            throw new InvalidOperationException($"A group named '{trimmedName}' already exists.");

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

        var group = new BulkRunScheduleGroup
        {
            Name = trimmedName,
            Description = description?.Trim() ?? string.Empty,
            IsActive = true,
            CreatedUtc = DateTime.UtcNow,
            CreatedBy = "RoutedOps:group-create",
        };
        Context.BulkRunScheduleGroups.Add(group);
        await Context.SaveChangesAsync();

        foreach (var id in memberIds)
        {
            Context.BulkRunScheduleGroupMembers.Add(new BulkRunScheduleGroupMember
            {
                GroupId = group.GroupId,
                ScheduleId = id,
            });
        }
        if (memberIds.Count > 0) await Context.SaveChangesAsync();

        return group.GroupId;
    }

    /// <summary>
    /// Hard-delete a Schedule Group + all its members (FK is CASCADE
    /// per migration 20260914140000). Does NOT touch the underlying
    /// schedules or their link rows - only the bundle metadata.
    /// </summary>
    public async Task DeleteGroupAsync(int groupId)
    {
        var group = await Context.BulkRunScheduleGroups
            .FirstOrDefaultAsync(g => g.GroupId == groupId)
            ?? throw new InvalidOperationException($"Group {groupId} not found.");
        Context.BulkRunScheduleGroups.Remove(group);
        await Context.SaveChangesAsync();
    }

    /// <summary>Rename / redescribe a Schedule Group.</summary>
    public async Task UpdateGroupAsync(int groupId, string name, string description)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Group name is required.");
        var trimmedName = name.Trim();
        var group = await Context.BulkRunScheduleGroups
            .FirstOrDefaultAsync(g => g.GroupId == groupId)
            ?? throw new InvalidOperationException($"Group {groupId} not found.");
        if (group.Name != trimmedName
            && await Context.BulkRunScheduleGroups.AsNoTracking()
                .AnyAsync(g => g.Name == trimmedName && g.GroupId != groupId))
            throw new InvalidOperationException($"A group named '{trimmedName}' already exists.");
        group.Name = trimmedName;
        group.Description = description?.Trim() ?? string.Empty;
        await Context.SaveChangesAsync();
    }

    /// <summary>Add member schedules to a group. Idempotent.</summary>
    public async Task<int> AddGroupMembersAsync(int groupId, IEnumerable<int> scheduleIds)
    {
        var ids = (scheduleIds ?? Array.Empty<int>()).Where(v => v > 0).Distinct().ToList();
        if (ids.Count == 0) return 0;
        _ = await Context.BulkRunScheduleGroups.AsNoTracking()
            .FirstOrDefaultAsync(g => g.GroupId == groupId)
            ?? throw new InvalidOperationException($"Group {groupId} not found.");

        var liveIds = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => ids.Contains(h.ScheduleId) && h.RetiredUtc == null)
            .Select(h => h.ScheduleId)
            .ToListAsync();
        var missing = ids.Except(liveIds).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException($"Schedule ids not found or retired: {string.Join(", ", missing)}.");

        var existing = await Context.BulkRunScheduleGroupMembers.AsNoTracking()
            .Where(m => m.GroupId == groupId && ids.Contains(m.ScheduleId))
            .Select(m => m.ScheduleId)
            .ToListAsync();
        var already = new HashSet<int>(existing);

        var toAdd = ids.Where(id => !already.Contains(id))
            .Select(id => new BulkRunScheduleGroupMember { GroupId = groupId, ScheduleId = id })
            .ToList();
        if (toAdd.Count == 0) return 0;
        Context.BulkRunScheduleGroupMembers.AddRange(toAdd);
        await Context.SaveChangesAsync();
        return toAdd.Count;
    }

    /// <summary>Remove a schedule from a group.</summary>
    public async Task<int> RemoveGroupMemberAsync(int groupId, int scheduleId)
    {
        var row = await Context.BulkRunScheduleGroupMembers
            .FirstOrDefaultAsync(m => m.GroupId == groupId && m.ScheduleId == scheduleId);
        if (row == null) return 0;
        Context.BulkRunScheduleGroupMembers.Remove(row);
        await Context.SaveChangesAsync();
        return 1;
    }

    /// <summary>
    /// Attach one or more clients to every non-default member schedule
    /// of a group. Default members (IsDefault = 1) are skipped per
    /// Steve's brief section 2 semantics: the link table is the sole
    /// record of who uses what, and defaults do not need per-client
    /// rows. Returns the total number of link rows added.
    /// </summary>
    public async Task<int> AttachClientsToGroupAsync(int groupId, IEnumerable<int> clientIds)
    {
        var ids = (clientIds ?? Array.Empty<int>()).Where(v => v > 0).Distinct().ToList();
        if (ids.Count == 0) return 0;

        var memberScheduleIds = await Context.BulkRunScheduleGroupMembers.AsNoTracking()
            .Where(m => m.GroupId == groupId)
            .Select(m => m.ScheduleId)
            .ToListAsync();
        if (memberScheduleIds.Count == 0)
            throw new InvalidOperationException($"Group {groupId} has no members.");

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
                    CreatedBy = $"RoutedOps:group-attach:{groupId}",
                });
            }
        }

        if (toAdd.Count > 0)
        {
            Context.ScheduleClients.AddRange(toAdd);
            await Context.SaveChangesAsync();
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
