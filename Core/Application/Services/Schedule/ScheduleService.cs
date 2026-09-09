using Microsoft.EntityFrameworkCore;
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
public class ScheduleService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
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
    public async Task<List<ScheduleGroupSummaryDto>> ListSummaryAsync(int? clientId, bool includeClientSpecific = false)
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
            })
            .ToListAsync();

        var allScheduleIds = rowBases.Select(r => r.BulkRunScheduleId).ToHashSet();

        var zoneCountByScheduleId = await Context.BulkZoneSchedules.AsNoTracking()
            .Where(z => z.Active == true && z.ScheduleId.HasValue && allScheduleIds.Contains(z.ScheduleId.Value))
            .GroupBy(z => z.ScheduleId!.Value)
            .Select(g => new { ScheduleId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.ScheduleId, x => x.Count);

        var scheduleIdsWithActiveLinehaul = (await Context.TblBulkScheduleLinehauls.AsNoTracking()
            .Where(l => l.Active == true && l.BulkRunScheduleId.HasValue && allScheduleIds.Contains(l.BulkRunScheduleId.Value))
            .Select(l => l.BulkRunScheduleId!.Value)
            .Distinct()
            .ToListAsync()).ToHashSet();

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
                var clientCount = linkClientsByHeaderId.TryGetValue(header.ScheduleId, out var ids) ? ids.Count : 0;
                var postcodeCount = postcodeCountByName.TryGetValue(header.Name, out var pc) ? pc : 0;
                var polygonCount = polygonCountByName.TryGetValue(header.Name, out var poc) ? poc : 0;
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
                    linkedClientCodes);
            });

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
    /// not break.</summary>
    public async Task<ScheduleGroupDto> GetDetailAsync(string name, int? legacyClientId)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Schedule name is required.");
        var trimmed = name.Trim();
        var header = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .FirstOrDefaultAsync(h => h.Name == trimmed
                && h.LegacyClientId == legacyClientId
                && h.RetiredUtc == null);
        if (header == null)
            throw new InvalidOperationException($"Schedule group '{trimmed}' not found.");
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
        var clientCodes = neededClientIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucClients.AsNoTracking()
                .Where(c => neededClientIds.Contains(c.UcclId) && c.UcclCode != null)
                .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);

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
            depotNames, speedNames, groupNames, dropOffNames, clientCodes);
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
        var clientCodes = await Context.TucClients.AsNoTracking()
            .Where(c => c.UcclCode != null)
            .Take(50000)
            .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);

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
                    depotNames, speedNames, groupNames, dropOffNames, clientCodes);
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
        Dictionary<int, string> clientCodes)
    {
        string LookupClientCode(int id) =>
            clientCodes.TryGetValue(id, out var c) && !string.IsNullOrWhiteSpace(c) ? c : $"#{id}";
        var t = rows[0];
        string LookupDepot(int? id) => id.HasValue && depotNames.TryGetValue(id.Value, out var n) ? n : null;
        string LookupSpeed(int? id) => id.HasValue && speedNames.TryGetValue(id.Value, out var n) ? n : null;
        string LookupGroup(int? id) => id.HasValue && groupNames.TryGetValue(id.Value, out var n) ? n : null;
        string LookupDropOff(int? id) => id.HasValue && dropOffNames.TryGetValue(id.Value, out var n) ? n : null;

        var clientIds = clientJunctions
            .Where(x => x.ScheduleId == header.ScheduleId)
            .Select(x => x.ClientId)
            .OrderBy(x => x)
            .ToList();
        var clientCodesForGroup = clientIds.Select(LookupClientCode).ToList();
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
                l.FromClientAddress, l.DropOffLocationId))
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
            clientIds, clientCodesForGroup, postcodeIds, polygonIds);
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
        };

    private static TimeSpan ParseTime(string hhmm)
    {
        if (TimeSpan.TryParse(hhmm, out var ts)) return ts;
        throw new InvalidOperationException($"Invalid time format: '{hhmm}'. Use HH:mm.");
    }
}
