using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Schedule;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.Schedule;

/// <summary>
/// Schedule module service. Owns group-shaped reads + writes on top of
/// the tblBulkRunSchedule row-per-(name, clientId, dayOfWeek) DB model.
///
/// A "schedule group" is identified by (Name, ClientId). All rows sharing
/// that pair are the group's day-windows. The service groups on read
/// and syncs on write:
///
///   Read:  GROUP BY (Name, ClientId) -> ScheduleGroupDto with DayWindows[]
///          + junction rows (clients / postcodes / polygons)
///   Write: sync N day-rows against DayWindows array (insert/update/delete)
///          + sync three junctions against the id arrays
///
/// Group identity for new schedules uses the tblScheduleClient junction
/// (Name-only key); legacy per-client override rows are read as separate
/// groups so old data still renders.
/// </summary>
public class ScheduleService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    // ─── READS ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Slim list-view projection used by the Schedules tab. Avoids the
    /// heavy .Include(BulkZoneSchedules) + .Include(TblBulkScheduleLinehauls)
    /// path that GetAsync takes; instead does server-side count aggregates
    /// on the junction / zone / linehaul tables. 4s -> sub-500ms on the
    /// initial page load. Full detail comes via GetDetailAsync when the
    /// operator opens a row.
    /// </summary>
    public async Task<List<ScheduleGroupSummaryDto>> ListSummaryAsync(int? clientId)
    {
        // Small lookup dictionaries. Depots + speeds are tiny + used for
        // the Destination / Speed columns in the table.
        var depotNames = await Context.TblBulkRegions.AsNoTracking()
            .ToDictionaryAsync(r => r.BulkRegionId, r => r.Name);
        var speedNames = await Context.TucJobTypes.AsNoTracking()
            .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);

        // Junction rows. Client-junction is loaded whole so we can both
        // count per name AND filter groups by target client. Postcode /
        // polygon are aggregated to just their per-name count - the ids
        // themselves are only needed on the edit modal.
        var clientJunctionsByName = (await Context.ScheduleClients.AsNoTracking()
            .Select(x => new { x.ScheduleName, x.ClientId })
            .ToListAsync())
            .GroupBy(x => x.ScheduleName)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ClientId).ToHashSet());
        var postcodeCountByName = await Context.SchedulePostcodes.AsNoTracking()
            .GroupBy(x => x.ScheduleName)
            .Select(g => new { Name = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Name, x => x.Count);
        var polygonCountByName = await Context.SchedulePolygons.AsNoTracking()
            .GroupBy(x => x.ScheduleName)
            .Select(g => new { Name = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Name, x => x.Count);

        // Schedule row bases - projection-only, NO Includes.
        // ~99 schedules * ~7 days = ~700 tiny rows.
        var rowBases = await Context.TblBulkRunSchedules.AsNoTracking()
            .Select(s => new
            {
                s.BulkRunScheduleId,
                s.Name,
                LegacyClientId = s.ClientId,
                s.Region,
                s.SpeedId,
                s.DayOfWeek,
                s.AutoBook,
            })
            .ToListAsync();

        var allScheduleIds = rowBases.Select(r => r.BulkRunScheduleId).ToHashSet();

        // Active-zone count per ScheduleId. Server-side GROUP BY, one
        // row per schedule that has any active zones.
        var zoneCountByScheduleId = await Context.BulkZoneSchedules.AsNoTracking()
            .Where(z => z.Active == true && z.ScheduleId.HasValue && allScheduleIds.Contains(z.ScheduleId.Value))
            .GroupBy(z => z.ScheduleId!.Value)
            .Select(g => new { ScheduleId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.ScheduleId, x => x.Count);

        // Schedule ids that have at least one active linehaul.
        var scheduleIdsWithActiveLinehaul = (await Context.TblBulkScheduleLinehauls.AsNoTracking()
            .Where(l => l.Active == true && l.BulkRunScheduleId.HasValue && allScheduleIds.Contains(l.BulkRunScheduleId.Value))
            .Select(l => l.BulkRunScheduleId!.Value)
            .Distinct()
            .ToListAsync()).ToHashSet();

        // Legacy client id -> code. Only for the orange chip on legacy
        // per-client override rows; usually a tiny set.
        var legacyClientIds = rowBases
            .Where(r => r.LegacyClientId.HasValue)
            .Select(r => r.LegacyClientId!.Value)
            .Distinct()
            .ToList();
        var legacyClientCodes = legacyClientIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucClients.AsNoTracking()
                .Where(c => legacyClientIds.Contains(c.UcclId) && c.UcclCode != null)
                .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);

        var summaries = rowBases
            .GroupBy(r => new { r.Name, r.LegacyClientId })
            .Select(g =>
            {
                var first = g.First();
                var activeDays = g
                    .Select(x => (int)(x.DayOfWeek ?? 0))
                    .Where(d => d > 0)
                    .Distinct()
                    .OrderBy(d => d)
                    .ToArray();
                // Zones apply per-group; pick the richest count across the
                // group's schedule rows so legacy drift doesn't under-report.
                var activeZones = g
                    .Select(x => zoneCountByScheduleId.TryGetValue(x.BulkRunScheduleId, out var c) ? c : 0)
                    .DefaultIfEmpty(0).Max();
                var hasLh = g.Any(x => scheduleIdsWithActiveLinehaul.Contains(x.BulkRunScheduleId));
                var clientCount = clientJunctionsByName.TryGetValue(first.Name, out var ids) ? ids.Count : 0;
                var postcodeCount = postcodeCountByName.TryGetValue(first.Name, out var pc) ? pc : 0;
                var polygonCount = polygonCountByName.TryGetValue(first.Name, out var poc) ? poc : 0;
                var legacyCode = first.LegacyClientId.HasValue
                    && legacyClientCodes.TryGetValue(first.LegacyClientId.Value, out var code)
                    ? code : null;
                return new ScheduleGroupSummaryDto(
                    first.Name,
                    first.LegacyClientId,
                    legacyCode,
                    first.Region ?? 0,
                    first.Region.HasValue && depotNames.TryGetValue(first.Region.Value, out var rn) ? rn : null,
                    first.SpeedId,
                    first.SpeedId.HasValue && speedNames.TryGetValue(first.SpeedId.Value, out var sn) ? sn : null,
                    activeDays,
                    activeZones,
                    clientCount, postcodeCount, polygonCount,
                    first.AutoBook, hasLh);
            });

        // Apply client filter (same semantics as GetAsync).
        if (clientId.HasValue)
        {
            var target = clientId.Value;
            summaries = summaries.Where(s => s.LegacyClientId == target
                || (clientJunctionsByName.TryGetValue(s.Name, out var ids) && ids.Contains(target)));
        }
        else
        {
            summaries = summaries.Where(s => s.LegacyClientId == null && s.ClientCount == 0);
        }

        return summaries.OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Full detail for one group. Called when the operator opens
    /// the edit or copy modal - avoids paying the include cost for every
    /// schedule up front on the list load.</summary>
    public async Task<ScheduleGroupDto> GetDetailAsync(string name, int? legacyClientId)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Schedule name is required.");
        var trimmed = name.Trim();

        // Same lookup dictionaries GetAsync uses, but only the ones actually
        // read by MapGroup. Small tables so no scope trim needed.
        var depotNames = await Context.TblBulkRegions.AsNoTracking()
            .ToDictionaryAsync(r => r.BulkRegionId, r => r.Name);
        var speedNames = await Context.TucJobTypes.AsNoTracking()
            .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);
        var groupNames = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .ToDictionaryAsync(g => g.Id, g => g.Name);
        var dropOffNames = await Context.TblDropOffLocations.AsNoTracking()
            .ToDictionaryAsync(d => d.DropOffLocationId, d => d.Name);
        // Client codes: only need the ones bound to THIS group's junction
        // rows + the legacy id (if any). Load them narrowly.
        var junctionClientIds = await Context.ScheduleClients.AsNoTracking()
            .Where(x => x.ScheduleName == trimmed)
            .Select(x => x.ClientId)
            .ToListAsync();
        var neededClientIds = junctionClientIds.ToHashSet();
        if (legacyClientId.HasValue) neededClientIds.Add(legacyClientId.Value);
        var clientCodes = neededClientIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucClients.AsNoTracking()
                .Where(c => neededClientIds.Contains(c.UcclId) && c.UcclCode != null)
                .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);

        // Junction rows scoped to this group only.
        var clientJunctions = await Context.ScheduleClients.AsNoTracking()
            .Where(x => x.ScheduleName == trimmed).ToListAsync();
        var postcodeJunctions = await Context.SchedulePostcodes.AsNoTracking()
            .Where(x => x.ScheduleName == trimmed).ToListAsync();
        var polygonJunctions = await Context.SchedulePolygons.AsNoTracking()
            .Where(x => x.ScheduleName == trimmed).ToListAsync();

        // Schedule rows for THIS group only, with the two heavy includes.
        var rows = await Context.TblBulkRunSchedules.AsNoTracking()
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .Where(s => s.Name == trimmed && s.ClientId == legacyClientId)
            .OrderBy(s => s.DayOfWeek)
            .ToListAsync();
        if (rows.Count == 0)
            throw new InvalidOperationException($"Schedule group '{trimmed}' not found.");

        return MapGroup(trimmed, legacyClientId, rows,
            clientJunctions, postcodeJunctions, polygonJunctions,
            depotNames, speedNames, groupNames, dropOffNames, clientCodes);
    }

    /// <summary>
    /// List schedule groups. If clientId is provided, only groups that
    /// bind to that client (either via legacy ClientId column or via the
    /// tblScheduleClient junction) are returned. Operator-facing UIs
    /// should pass clientCode via GetByClientCodeAsync instead; internal
    /// callers already keyed by id can keep using this overload.
    /// </summary>
    public async Task<List<ScheduleGroupDto>> GetAsync(int? clientId)
    {
        // Lookup dictionaries (small tables, one-shot loads).
        var depotNames = await Context.TblBulkRegions.AsNoTracking()
            .ToDictionaryAsync(r => r.BulkRegionId, r => r.Name);
        var speedNames = await Context.TucJobTypes.AsNoTracking()
            .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);
        var groupNames = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .ToDictionaryAsync(g => g.Id, g => g.Name);
        var dropOffNames = await Context.TblDropOffLocations.AsNoTracking()
            .ToDictionaryAsync(d => d.DropOffLocationId, d => d.Name);
        // Client codes for the LegacyClientCode + ClientCodes fields.
        // Cap at 50k to avoid pulling every historical client on huge
        // tenants; operators only ever look at active-ish sets.
        var clientCodes = await Context.TucClients.AsNoTracking()
            .Where(c => c.UcclCode != null)
            .Take(50000)
            .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);

        // All row-level junctions in one shot (small tables, filtered where
        // possible by clientId if provided).
        var clientJunctions = await Context.ScheduleClients.AsNoTracking().ToListAsync();
        var postcodeJunctions = await Context.SchedulePostcodes.AsNoTracking().ToListAsync();
        var polygonJunctions = await Context.SchedulePolygons.AsNoTracking().ToListAsync();

        var rows = await Context.TblBulkRunSchedules.AsNoTracking()
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .OrderBy(s => s.Name)
            .ThenBy(s => s.DayOfWeek)
            .ToListAsync();

        // Group by (Name, LegacyClientId). LegacyClientId is nullable so
        // (Name, null) is the "default" group; (Name, 36813) is the
        // per-client override group (legacy pattern).
        var groups = rows
            .GroupBy(r => new { r.Name, LegacyClientId = r.ClientId })
            .Select(g => MapGroup(
                g.Key.Name, g.Key.LegacyClientId, g.ToList(),
                clientJunctions, postcodeJunctions, polygonJunctions,
                depotNames, speedNames, groupNames, dropOffNames, clientCodes))
            .ToList();

        if (clientId.HasValue)
        {
            var target = clientId.Value;
            groups = groups
                .Where(g => g.LegacyClientId == target || g.ClientIds.Contains(target))
                .ToList();
        }
        else
        {
            // Default view = groups with no client binding at all
            // (LegacyClientId null AND no junction rows).
            groups = groups
                .Where(g => g.LegacyClientId == null && g.ClientIds.Count == 0)
                .ToList();
        }

        return groups;
    }

    /// <summary>Summary variant of GetByClientCodeAsync - resolves the
    /// code then delegates to ListSummaryAsync.</summary>
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

    /// <summary>
    /// List schedule groups by client CODE (operator-friendly). Resolves
    /// the code to a ClientId server-side then delegates to GetAsync.
    /// Empty/null code = default view (client-agnostic groups).
    /// </summary>
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

    /// <summary>
    /// Search clients by code OR name (case-insensitive LIKE). Backing
    /// query is server-side because staging has 15k+ clients and the
    /// lookups-bundle cap (500 rows ordered by code) can never surface
    /// operator-typed codes that fall past position 500 alphabetically.
    ///
    /// Empty / whitespace `q` returns the first `limit` active clients
    /// ordered by code (useful for initial browse). Non-empty `q`
    /// does a substring match on Code + Name, top `limit` hits.
    /// </summary>
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

        // Clients dropdown - active clients only, for the multi-client
        // picker on the schedule edit modal. Take/OrderBy applied after
        // the Active filter to keep the payload small (tenants can have
        // 10k+ clients; the picker uses type-ahead search on top of this).
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

        // Project only the columns the run dropdown needs. Previously
        // pulled full TblbulkLinehaulRun rows (defaultTargetType, speedId,
        // mode, masterBookingId, ~15 extra columns) just to shape into
        // the small dropdown DTO in memory - server-side projection cuts
        // the wire + memory footprint 10-15x.
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
    /// Upsert a schedule group. If a group with that (Name, ClientId=null)
    /// exists it is updated; otherwise created. LegacyClientId is not
    /// writable via this path - new groups always use the junction for
    /// multi-client binding.
    /// </summary>
    public async Task<ScheduleGroupDto> UpsertAsync(ScheduleGroupUpsertRequest req)
    {
        ValidateUpsert(req);
        var linehaulError = ValidateLinehauls(req.Linehauls);
        if (linehaulError != null) throw new InvalidOperationException(linehaulError);

        var name = req.Name.Trim();

        // Existing rows for this group name (ClientId = null path only -
        // legacy per-client groups are read-only in the new UI).
        var existing = await Context.TblBulkRunSchedules
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .Where(s => s.Name == name && s.ClientId == null)
            .ToListAsync();

        // Sync day-window rows against DayWindows array. Match by Id
        // when present, else by DayOfWeek. Rows not in the request are
        // deleted; new rows are inserted.
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

        // Upsert each day-window against the surviving existing rows.
        foreach (var w in req.DayWindows)
        {
            var row = w.Id.HasValue
                ? existing.FirstOrDefault(r => r.BulkRunScheduleId == w.Id.Value)
                : existing.FirstOrDefault(r => r.DayOfWeek == w.DayOfWeek);
            if (row == null)
            {
                row = new TblBulkRunSchedule { Name = name, ClientId = null, MaxJobs = 10000 };
                Context.TblBulkRunSchedules.Add(row);
                existing.Add(row);
            }
            ApplyGroupTemplateToRow(row, req);
            row.DayOfWeek = w.DayOfWeek;
            row.StartTime = ParseTime(w.StartTime);
            row.EndTime = ParseTime(w.EndTime);
            row.CutoffHours = w.CutoffHours;
        }

        // Zones + linehauls apply to EVERY row in the group. Simplest
        // correct sync: clear then re-add on each row. Cheap because
        // both tables are tiny per schedule. Attached via nav collections
        // so EF handles the FK cascade on insert regardless of parent
        // persistence order - no intermediate SaveChangesAsync needed.
        foreach (var row in existing)
        {
            Context.BulkZoneSchedules.RemoveRange(row.BulkZoneSchedules);
            Context.TblBulkScheduleLinehauls.RemoveRange(row.TblBulkScheduleLinehauls);
            foreach (var z in req.Zones ?? Enumerable.Empty<ScheduleZoneUpsertRequest>())
                row.BulkZoneSchedules.Add(new BulkZoneSchedule { Zone = z.Zone, Active = z.Active });
            foreach (var l in req.Linehauls ?? Enumerable.Empty<ScheduleLinehaulUpsertRequest>())
                row.TblBulkScheduleLinehauls.Add(MapLinehaulToEntity(l));
        }

        // Resolve client codes -> ids (before any junction writes so a
        // bad code throws with nothing persisted).
        var resolvedClientIds = new List<int>(req.ClientIds ?? new());
        if (req.ClientCodes != null)
        {
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

        // Junction sync queued alongside everything else - one atomic
        // SaveChangesAsync commits the full graph so partial failures
        // (permission errors, constraint violations) roll back cleanly.
        // Previously three separate saves left orphan rows on failure.
        await SyncClientsAsync(name, resolvedClientIds);
        await SyncPostcodesAsync(name, req.PostcodeIds);
        await SyncPolygonsAsync(name, req.PolygonIds);

        await Context.SaveChangesAsync();

        return await ReloadAsync(name, null);
    }

    public async Task DeleteAsync(string name, int? legacyClientId)
    {
        var rows = await Context.TblBulkRunSchedules
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .Where(s => s.Name == name && s.ClientId == legacyClientId)
            .ToListAsync();
        if (rows.Count == 0) throw new InvalidOperationException("Schedule not found.");

        foreach (var row in rows)
        {
            Context.BulkZoneSchedules.RemoveRange(row.BulkZoneSchedules);
            Context.TblBulkScheduleLinehauls.RemoveRange(row.TblBulkScheduleLinehauls);
        }
        Context.TblBulkRunSchedules.RemoveRange(rows);

        // Clear junctions too (only for the default/junction-based group,
        // legacy per-client groups don't own any junction rows).
        if (legacyClientId == null)
        {
            var clientLinks = await Context.ScheduleClients.Where(x => x.ScheduleName == name).ToListAsync();
            var postcodeLinks = await Context.SchedulePostcodes.Where(x => x.ScheduleName == name).ToListAsync();
            var polygonLinks = await Context.SchedulePolygons.Where(x => x.ScheduleName == name).ToListAsync();
            Context.ScheduleClients.RemoveRange(clientLinks);
            Context.SchedulePostcodes.RemoveRange(postcodeLinks);
            Context.SchedulePolygons.RemoveRange(polygonLinks);
        }

        await Context.SaveChangesAsync();
    }

    /// <summary>
    /// Copy a schedule group: clone every tblBulkRunSchedule row + zones +
    /// linehauls + junction bindings under a new name (and optionally a new
    /// client set). Returns the freshly-hydrated new group DTO.
    ///
    /// Copies:
    ///  * Day-windows (all N rows, new BulkRunScheduleIds)
    ///  * BulkZoneSchedule rows (per-day active-zone activations)
    ///  * TblBulkScheduleLinehaul rows (per-day linehaul legs, with WeekDay/
    ///    Amount/DepartureAdvanceDays/... verbatim)
    ///  * tblSchedulePostcode + tblSchedulePolygon rows (rekeyed to NewName)
    ///
    /// Clients: if ClientCodes / ClientIds supplied, uses those; otherwise
    /// copies the source group's client bindings from tblScheduleClient.
    /// New group's LegacyClientId is always null (new junction pattern).
    /// </summary>
    public async Task<ScheduleGroupDto> CopyAsync(ScheduleCopyRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.SourceName))
            throw new InvalidOperationException("Source name is required.");
        if (string.IsNullOrWhiteSpace(req.NewName))
            throw new InvalidOperationException("New name is required.");

        var sourceName = req.SourceName.Trim();
        var newName = req.NewName.Trim();

        if (string.Equals(sourceName, newName, StringComparison.OrdinalIgnoreCase)
            && req.SourceLegacyClientId == null)
            throw new InvalidOperationException("New name must differ from the source name for a default (junction-based) copy.");

        // Reject if the target name already exists as a default group -
        // avoids the operator accidentally merging two independently-
        // authored groups when they meant to fork.
        var targetExists = await Context.TblBulkRunSchedules
            .AnyAsync(s => s.Name == newName && s.ClientId == null);
        if (targetExists)
            throw new InvalidOperationException($"A schedule named '{newName}' already exists. Pick a different name.");

        var sourceRows = await Context.TblBulkRunSchedules
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .Where(s => s.Name == sourceName && s.ClientId == req.SourceLegacyClientId)
            .ToListAsync();
        if (sourceRows.Count == 0)
            throw new InvalidOperationException("Source schedule not found.");

        // Resolve target client ids BEFORE any writes so a bad code
        // throws before we've persisted anything.
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
            // Inherit source group's junction clients only (LegacyClientId
            // is on the row set, not junction - it doesn't get duplicated).
            targetClientIds = await Context.ScheduleClients.AsNoTracking()
                .Where(x => x.ScheduleName == sourceName)
                .Select(x => x.ClientId)
                .ToListAsync();
        }

        // Read the other two junctions to copy verbatim (rekey to NewName).
        var srcPostcodes = await Context.SchedulePostcodes.AsNoTracking()
            .Where(x => x.ScheduleName == sourceName)
            .Select(x => x.PostCode)
            .ToListAsync();
        var srcPolygons = await Context.SchedulePolygons.AsNoTracking()
            .Where(x => x.ScheduleName == sourceName)
            .Select(x => x.PolygonId)
            .ToListAsync();

        // Duplicate each source row as a new one. Wire fresh
        // BulkZoneSchedule + TblBulkScheduleLinehaul rows off each clone.
        foreach (var src in sourceRows)
        {
            var clone = new Domain.Despatch.TblBulkRunSchedule
            {
                Name = newName,
                ClientId = null, // new junction pattern
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
                clone.BulkZoneSchedules.Add(new Domain.Despatch.BulkZoneSchedule { Zone = z.Zone, Active = z.Active });
            foreach (var l in src.TblBulkScheduleLinehauls)
                clone.TblBulkScheduleLinehauls.Add(new Domain.Despatch.TblBulkScheduleLinehaul
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

        // Junction tracker inserts (no DB write yet - queued alongside
        // the parent Adds so ONE SaveChangesAsync commits everything
        // atomically in an implicit transaction. Fixes the earlier
        // partial-failure bug where a permission error on tblScheduleClient
        // left orphan parent rows behind because parent + junction saves
        // ran in two separate transactions.
        await SyncClientsAsync(newName, targetClientIds);
        await SyncPostcodesAsync(newName, srcPostcodes);
        await SyncPolygonsAsync(newName, srcPolygons);

        // Single atomic commit - parent rows + zones + linehauls +
        // 3 junctions all in one EF transaction.
        await Context.SaveChangesAsync();

        return await ReloadAsync(newName, null);
    }

    /// <summary>
    /// Toggle AutoBook across every row in the group. Returns the new
    /// value (mirrors legacy /API/Schedules/AutoBookUpdate semantics
    /// applied to a group instead of a single row).
    /// </summary>
    public async Task<bool> ToggleAutoBookAsync(string name, int? legacyClientId)
    {
        var rows = await Context.TblBulkRunSchedules
            .Where(s => s.Name == name && s.ClientId == legacyClientId)
            .ToListAsync();
        if (rows.Count == 0) throw new InvalidOperationException("Schedule not found.");
        var newValue = !(rows[0].AutoBook ?? false);
        foreach (var r in rows) r.AutoBook = newValue;
        await Context.SaveChangesAsync();
        return newValue;
    }

    // ─── HELPERS ───────────────────────────────────────────────────────────

    private async Task SyncClientsAsync(string name, IEnumerable<int> desired)
    {
        var current = await Context.ScheduleClients
            .Where(x => x.ScheduleName == name)
            .ToListAsync();
        var desiredSet = new HashSet<int>(desired ?? Enumerable.Empty<int>());
        Context.ScheduleClients.RemoveRange(current.Where(x => !desiredSet.Contains(x.ClientId)));
        var currentIds = new HashSet<int>(current.Select(x => x.ClientId));
        foreach (var id in desiredSet.Where(id => !currentIds.Contains(id)))
        {
            Context.ScheduleClients.Add(new ScheduleClient
            {
                ScheduleName = name, ClientId = id, CreatedUtc = DateTime.UtcNow,
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

    private async Task<ScheduleGroupDto> ReloadAsync(string name, int? legacyClientId)
    {
        var groups = await GetAsync(clientId: null);
        var one = groups.FirstOrDefault(g => g.Name == name && g.LegacyClientId == legacyClientId);
        if (one != null) return one;
        // Fallback: legacy per-client override was created; re-scan the
        // per-client bucket.
        var all = await GetAllForNameAsync(name);
        return all.First(g => g.LegacyClientId == legacyClientId);
    }

    private async Task<List<ScheduleGroupDto>> GetAllForNameAsync(string name)
    {
        var depotNames = await Context.TblBulkRegions.AsNoTracking().ToDictionaryAsync(r => r.BulkRegionId, r => r.Name);
        var speedNames = await Context.TucJobTypes.AsNoTracking().ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);
        var groupNames = await Context.BulkZonePostcodeGroups.AsNoTracking().ToDictionaryAsync(g => g.Id, g => g.Name);
        var dropOffNames = await Context.TblDropOffLocations.AsNoTracking().ToDictionaryAsync(d => d.DropOffLocationId, d => d.Name);
        var clientJunctions = await Context.ScheduleClients.AsNoTracking().Where(x => x.ScheduleName == name).ToListAsync();
        var postcodeJunctions = await Context.SchedulePostcodes.AsNoTracking().Where(x => x.ScheduleName == name).ToListAsync();
        var polygonJunctions = await Context.SchedulePolygons.AsNoTracking().Where(x => x.ScheduleName == name).ToListAsync();
        var clientCodes = await Context.TucClients.AsNoTracking()
            .Where(c => c.UcclCode != null)
            .Take(50000)
            .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);
        var rows = await Context.TblBulkRunSchedules.AsNoTracking()
            .Include(s => s.BulkZoneSchedules)
            .Include(s => s.TblBulkScheduleLinehauls)
            .Where(s => s.Name == name)
            .OrderBy(s => s.DayOfWeek)
            .ToListAsync();
        return rows
            .GroupBy(r => new { r.Name, LegacyClientId = r.ClientId })
            .Select(g => MapGroup(g.Key.Name, g.Key.LegacyClientId, g.ToList(),
                clientJunctions, postcodeJunctions, polygonJunctions,
                depotNames, speedNames, groupNames, dropOffNames, clientCodes))
            .ToList();
    }

    private static ScheduleGroupDto MapGroup(
        string name, int? legacyClientId, List<TblBulkRunSchedule> rows,
        List<ScheduleClient> clientJunctions,
        List<SchedulePostcode> postcodeJunctions,
        List<SchedulePolygon> polygonJunctions,
        Dictionary<int, string> depotNames,
        Dictionary<int, string> speedNames,
        Dictionary<int, string> groupNames,
        Dictionary<int, string> dropOffNames,
        Dictionary<int, string> clientCodes)
    {
        // Resolve client code from the lookup; fall back to "#{id}"
        // when the id isn't in the loaded dictionary (safer than an
        // empty display).
        string LookupClientCode(int id) =>
            clientCodes.TryGetValue(id, out var c) && !string.IsNullOrWhiteSpace(c) ? c : $"#{id}";
        // Template fields are the same across all rows in the group by
        // construction (single-writer sync above enforces this). Read
        // from the first row; if legacy data has drift, first row wins.
        var t = rows[0];
        string LookupDepot(int? id) => id.HasValue && depotNames.TryGetValue(id.Value, out var n) ? n : null;
        string LookupSpeed(int? id) => id.HasValue && speedNames.TryGetValue(id.Value, out var n) ? n : null;
        string LookupGroup(int? id) => id.HasValue && groupNames.TryGetValue(id.Value, out var n) ? n : null;
        string LookupDropOff(int? id) => id.HasValue && dropOffNames.TryGetValue(id.Value, out var n) ? n : null;

        // Junction rows are keyed by Name only (not per client). Legacy
        // per-client groups therefore share the same junction bindings
        // as the default group of the same name - that's intentional
        // for the transition period.
        var clientIds = clientJunctions
            .Where(x => x.ScheduleName == name)
            .Select(x => x.ClientId)
            .OrderBy(x => x)
            .ToList();
        var clientCodesForGroup = clientIds.Select(LookupClientCode).ToList();
        var legacyClientCode = legacyClientId.HasValue ? LookupClientCode(legacyClientId.Value) : null;
        var postcodeIds = postcodeJunctions
            .Where(x => x.ScheduleName == name)
            .Select(x => x.PostCode)
            .OrderBy(x => x)
            .ToList();
        var polygonIds = polygonJunctions
            .Where(x => x.ScheduleName == name)
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

        // Zones + linehauls apply per-group; take the first row's
        // collections (all rows share them by construction after our
        // sync). Legacy drift: first wins.
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
            name, legacyClientId, legacyClientCode,
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

    /// <summary>
    /// Port of ClientManager.ScheduleService.ValidateLinehauls (line 115-141).
    /// Returns the first error found, or null if every leg is valid.
    /// </summary>
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
