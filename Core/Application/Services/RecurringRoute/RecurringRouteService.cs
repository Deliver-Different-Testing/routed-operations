using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.RecurringRoute;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using Serilog;
using RouteEntity = RoutedOperations.Core.Domain.Despatch.Route;

namespace RoutedOperations.Core.Application.Services.RecurringRoute;

/// <summary>
/// Recurring routes module. Reuses the Configurator's existing Route /
/// ZipPolygon / Dispatch_RouteRoster tables so a route created here shows
/// up cleanly in DF Admin + drives the downstream prebook cron the same
/// way Configurator does.
///
/// TargetType convention (same as Configurator):
///   1 = Courier (DefaultCourierId set)
///   2 = Agent   (DefaultAgentId set, agent.IsNetworkPartner=0)
///   3 = Network Partner (DefaultAgentId set, agent.IsNetworkPartner=1)
/// </summary>
public class RecurringRouteService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IHttpContextAccessor httpContextAccessor)
    : BaseService(contextFactory)
{
    // ─── ROUTES ────────────────────────────────────────────────────────────

    public async Task<List<RouteDto>> GetAllAsync()
    {
        var rows = await Context.Routes
            .AsNoTracking()
            .Include(r => r.ZipPolygons)
            .Include(r => r.CustomZipPolygons)
            .Include(r => r.DispatchRouteRosters)
            .OrderByDescending(r => r.Active)
            .ThenBy(r => r.Name)
            .ToListAsync();

        // Resolve default-target names + schedule names in follow-up queries
        // rather than pushing nav-property projections into the initial SELECT
        // (keeps the SQL shape simple + avoids multi-tenant courier schema noise).
        var courierIds = rows.Where(r => r.DefaultTargetType == 1 && r.DefaultCourierId.HasValue)
            .Select(r => r.DefaultCourierId!.Value).Distinct().ToList();
        var couriers = courierIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucCouriers.AsNoTracking()
                .Where(c => courierIds.Contains(c.UccrId))
                .ToDictionaryAsync(c => c.UccrId, c => $"{c.Code} {c.UccrName}".Trim());

        var agentIds = rows.Where(r => r.DefaultTargetType is 2 or 3 && r.DefaultAgentId.HasValue)
            .Select(r => r.DefaultAgentId!.Value).Distinct().ToList();
        var agents = agentIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucAgents.AsNoTracking()
                .Where(a => agentIds.Contains(a.UcagId))
                .ToDictionaryAsync(a => a.UcagId, a => a.UcagName ?? string.Empty);

        var scheduleIds = rows.Where(r => r.ScheduleId.HasValue)
            .Select(r => r.ScheduleId!.Value).Distinct().ToList();
        var schedules = scheduleIds.Count == 0
            ? new Dictionary<int, (string Name, string Window)>()
            : (await Context.TblBulkRunSchedules.AsNoTracking()
                .Where(s => scheduleIds.Contains(s.BulkRunScheduleId))
                .Select(s => new { s.BulkRunScheduleId, s.Name, s.StartTime, s.EndTime })
                .ToListAsync())
              .ToDictionary(
                  s => s.BulkRunScheduleId,
                  s => (
                      s.Name ?? string.Empty,
                      FormatWindow(s.StartTime, s.EndTime)));

        return rows.Select(r =>
        {
            var (targetId, targetName) = ResolveTarget(r, couriers, agents);
            var (schedName, schedWin) = r.ScheduleId.HasValue && schedules.TryGetValue(r.ScheduleId.Value, out var s)
                ? s
                : (string.Empty, string.Empty);
            return new RouteDto(
                r.RouteId,
                r.Name ?? string.Empty,
                r.Area ?? string.Empty,
                r.DefaultTargetType,
                targetId,
                targetName,
                r.ScheduleId,
                schedName,
                schedWin,
                r.Active,
                r.ZipPolygons
                    .OrderBy(z => z.Zip)
                    .Select(z => new RouteZipcodeDto(z.ZipPolygonId, z.Zip ?? string.Empty))
                    .ToList(),
                r.CustomZipPolygons
                    .Where(c => c.Active)
                    .OrderBy(c => c.Name)
                    .Select(c => new RouteCustomPolygonDto(
                        c.CustomZipPolygonId, c.Name ?? string.Empty,
                        c.CentroidLatitude, c.CentroidLongitude))
                    .ToList(),
                r.DispatchRouteRosters.Count(rr => rr.IsActive),
                r.CreatedAt,
                r.UpdatedAt);
        }).ToList();
    }

    public async Task<RouteDto?> GetByIdAsync(int id)
    {
        var route = await Context.Routes
            .AsNoTracking()
            .Include(r => r.ZipPolygons)
            .Include(r => r.DispatchRouteRosters)
            .FirstOrDefaultAsync(r => r.RouteId == id);
        if (route is null) return null;
        // Fall through to the resolve-target logic used by GetAll by re-using
        // a single-item pass through the collective resolver - low volume,
        // simpler than duplicating the follow-up-lookup dance inline.
        var all = await GetAllAsync();
        return all.FirstOrDefault(r => r.RouteId == id);
    }

    public async Task<RouteDto> CreateAsync(UpsertRouteRequest req)
    {
        ValidateUpsert(req);
        var (courierId, agentId) = SplitTarget(req.DefaultTargetType, req.DefaultTargetId);

        var route = new RouteEntity
        {
            Name = req.Name.Trim(),
            Area = req.Area?.Trim() ?? string.Empty,
            DefaultTargetType = req.DefaultTargetType,
            DefaultCourierId = courierId,
            DefaultAgentId = agentId,
            ScheduleId = req.ScheduleId,
            Active = req.Active,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = CurrentUser(),
        };
        await AttachZipsAsync(route, req.ZipPolygonIds);
        await AttachCustomPolygonsAsync(route, req.CustomPolygonIds ?? new List<int>());
        Context.Routes.Add(route);
        await Context.SaveChangesAsync();
        Log.Information("Route {Id} ({Name}) created with {Zips} zip(s) and {Custom} custom polygon(s)",
            route.RouteId, route.Name, route.ZipPolygons.Count, route.CustomZipPolygons.Count);
        return (await GetByIdAsync(route.RouteId))!;
    }

    public async Task<RouteDto?> UpdateAsync(int id, UpsertRouteRequest req)
    {
        ValidateUpsert(req);
        var route = await Context.Routes
            .Include(r => r.ZipPolygons)
            .Include(r => r.CustomZipPolygons)
            .FirstOrDefaultAsync(r => r.RouteId == id);
        if (route is null) return null;

        var (courierId, agentId) = SplitTarget(req.DefaultTargetType, req.DefaultTargetId);

        route.Name = req.Name.Trim();
        route.Area = req.Area?.Trim() ?? string.Empty;
        route.DefaultTargetType = req.DefaultTargetType;
        route.DefaultCourierId = courierId;
        route.DefaultAgentId = agentId;
        route.ScheduleId = req.ScheduleId;
        route.Active = req.Active;
        route.UpdatedAt = DateTime.UtcNow;
        route.UpdatedBy = CurrentUser();

        // Replace zip coverage wholesale (matches Configurator UPDATE contract).
        route.ZipPolygons.Clear();
        await AttachZipsAsync(route, req.ZipPolygonIds);
        // Custom polygons: only replace if the caller sent a non-null list.
        // Null means "don't touch them" (backwards-compat with pre-Stage-2 callers).
        if (req.CustomPolygonIds is not null)
        {
            route.CustomZipPolygons.Clear();
            await AttachCustomPolygonsAsync(route, req.CustomPolygonIds);
        }
        await Context.SaveChangesAsync();
        Log.Information("Route {Id} updated ({Zips} zip(s), {Custom} custom polygon(s))",
            id, route.ZipPolygons.Count, route.CustomZipPolygons.Count);
        return await GetByIdAsync(id);
    }

    public async Task<RouteDto?> CopyAsync(int sourceRouteId, CopyRouteRequest req)
    {
        var source = await Context.Routes
            .AsNoTracking()
            .Include(r => r.ZipPolygons)
            .FirstOrDefaultAsync(r => r.RouteId == sourceRouteId);
        if (source is null) return null;
        var (courierId, agentId) = SplitTarget(req.DefaultTargetType, req.DefaultTargetId);

        var copy = new RouteEntity
        {
            Name = req.Name.Trim(),
            Area = source.Area ?? string.Empty,
            DefaultTargetType = req.DefaultTargetType ?? source.DefaultTargetType,
            DefaultCourierId = courierId ?? source.DefaultCourierId,
            DefaultAgentId = agentId ?? source.DefaultAgentId,
            ScheduleId = req.ScheduleId ?? source.ScheduleId,
            Active = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = CurrentUser(),
        };
        if (req.CopyZipcodes && source.ZipPolygons.Count > 0)
        {
            var zipIds = source.ZipPolygons.Select(z => z.ZipPolygonId).ToList();
            await AttachZipsAsync(copy, zipIds);
        }
        Context.Routes.Add(copy);
        await Context.SaveChangesAsync();
        Log.Information("Route {SourceId} copied to {CopyId} ({Name})",
            sourceRouteId, copy.RouteId, copy.Name);
        return await GetByIdAsync(copy.RouteId);
    }

    /// <summary>Soft-delete: sets Active=0. Physical delete is intentionally
    /// unsupported (tucJobBooking.RouteId FK dependency).</summary>
    public async Task<bool> SoftDeleteAsync(int id)
    {
        var route = await Context.Routes.FindAsync(id);
        if (route is null) return false;
        route.Active = false;
        route.UpdatedAt = DateTime.UtcNow;
        route.UpdatedBy = CurrentUser();
        await Context.SaveChangesAsync();
        Log.Information("Route {Id} soft-deleted", id);
        return true;
    }

    // ─── ROSTER ────────────────────────────────────────────────────────────

    public async Task<List<RouteRosterEntryDto>> GetRosterAsync(int routeId)
    {
        var rows = await Context.DispatchRouteRosters
            .AsNoTracking()
            .Where(rr => rr.RouteId == routeId)
            .OrderBy(rr => rr.IsActive ? 0 : 1)
            .ThenBy(rr => rr.DayOfWeek)
            .ThenBy(rr => rr.RosterDate)
            .ToListAsync();

        var courierIds = rows.Where(r => r.TargetType == 1 && r.CourierId.HasValue)
            .Select(r => r.CourierId!.Value).Distinct().ToList();
        var couriers = courierIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucCouriers.AsNoTracking()
                .Where(c => courierIds.Contains(c.UccrId))
                .ToDictionaryAsync(c => c.UccrId, c => $"{c.Code} {c.UccrName}".Trim());
        var agentIds = rows.Where(r => r.TargetType is 2 or 3 && r.AgentId.HasValue)
            .Select(r => r.AgentId!.Value).Distinct().ToList();
        var agents = agentIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucAgents.AsNoTracking()
                .Where(a => agentIds.Contains(a.UcagId))
                .ToDictionaryAsync(a => a.UcagId, a => a.UcagName ?? string.Empty);

        return rows.Select(r =>
        {
            int? targetId = r.TargetType == 1 ? r.CourierId : r.AgentId;
            string targetName = r.TargetType == 1 && r.CourierId.HasValue
                ? couriers.GetValueOrDefault(r.CourierId.Value, string.Empty)
                : r.TargetType is 2 or 3 && r.AgentId.HasValue
                    ? agents.GetValueOrDefault(r.AgentId.Value, string.Empty)
                    : string.Empty;
            return new RouteRosterEntryDto(
                r.RouteRosterId, r.RouteId, r.TargetType, targetId, targetName,
                r.RosterDate, r.DayOfWeek, r.IsActive, r.CreatedAt);
        }).ToList();
    }

    public async Task<RouteRosterEntryDto?> AddRosterAsync(int routeId, UpsertRouteRosterRequest req)
    {
        if (req.RosterDate.HasValue == req.DayOfWeek.HasValue)
        {
            throw new InvalidOperationException(
                "Exactly one of RosterDate or DayOfWeek must be set.");
        }

        // Deactivate any existing active row that would collide with the new
        // (route, date-or-dow) slot. Matches the unique filtered indexes on
        // the table (UX_DispatchRouteRoster_RouteDate_Active / _RouteDow_Active).
        var colliding = await Context.DispatchRouteRosters
            .Where(rr => rr.RouteId == routeId && rr.IsActive
                && (req.RosterDate.HasValue
                    ? rr.RosterDate == req.RosterDate
                    : rr.RosterDate == null && rr.DayOfWeek == req.DayOfWeek))
            .ToListAsync();
        foreach (var c in colliding) c.IsActive = false;

        var (courierId, agentId) = SplitTarget(req.TargetType, req.TargetId);
        var entry = new DispatchRouteRoster
        {
            RouteId = routeId,
            TargetType = req.TargetType,
            CourierId = courierId,
            AgentId = agentId,
            RosterDate = req.RosterDate,
            DayOfWeek = req.DayOfWeek,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = CurrentUser(),
        };
        Context.DispatchRouteRosters.Add(entry);
        await Context.SaveChangesAsync();
        Log.Information("Roster {Id} added to route {RouteId}",
            entry.RouteRosterId, routeId);
        var all = await GetRosterAsync(routeId);
        return all.FirstOrDefault(r => r.RouteRosterId == entry.RouteRosterId);
    }

    public async Task<bool> DeleteRosterAsync(int routeId, int rosterId)
    {
        var row = await Context.DispatchRouteRosters
            .FirstOrDefaultAsync(rr => rr.RouteId == routeId && rr.RouteRosterId == rosterId);
        if (row is null) return false;
        row.IsActive = false;
        await Context.SaveChangesAsync();
        Log.Information("Roster {Id} soft-deleted from route {RouteId}",
            rosterId, routeId);
        return true;
    }

    // ─── LOOKUPS ───────────────────────────────────────────────────────────

    public async Task<List<ZipcodeLookupDto>> SearchZipcodesAsync(string q, int max = 25)
    {
        if (string.IsNullOrWhiteSpace(q))
            return new List<ZipcodeLookupDto>();
        var needle = q.Trim();
        return await Context.ZipPolygons
            .AsNoTracking()
            .Where(z => z.Zip != null && z.Zip.StartsWith(needle))
            .OrderBy(z => z.Zip)
            .Take(max)
            .Select(z => new ZipcodeLookupDto(z.ZipPolygonId, z.Zip!, z.Latitude, z.Longitude))
            .ToListAsync();
    }

    public async Task<List<ZipPolygonShapeDto>> GetPolygonShapesAsync(IEnumerable<int> zipPolygonIds)
    {
        var ids = zipPolygonIds.Distinct().ToList();
        if (ids.Count == 0) return new List<ZipPolygonShapeDto>();
        return await Context.ZipPolygons
            .AsNoTracking()
            .Where(z => ids.Contains(z.ZipPolygonId))
            .Select(z => new ZipPolygonShapeDto(z.ZipPolygonId, z.Zip!, z.Latitude, z.Longitude, z.Wkt))
            .ToListAsync();
    }

    public async Task<AssignableTargetsResponse> GetAssignableTargetsAsync()
    {
        var couriers = await Context.TucCouriers
            .AsNoTracking()
            .Where(c => c.Active)
            .OrderBy(c => c.Code)
            .Select(c => new AssignableTargetDto(c.UccrId, $"{c.Code} {c.UccrName}".Trim(), c.Code ?? string.Empty))
            .ToListAsync();

        var agentsRaw = await Context.TucAgents
            .AsNoTracking()
            .OrderBy(a => a.UcagName)
            .Select(a => new { a.UcagId, a.UcagName, a.IsNetworkPartner })
            .ToListAsync();

        var agents = agentsRaw
            .Where(a => !a.IsNetworkPartner)
            .Select(a => new AssignableTargetDto(a.UcagId, a.UcagName ?? "(unnamed agent)", "Agent"))
            .ToList();
        var nps = agentsRaw
            .Where(a => a.IsNetworkPartner)
            .Select(a => new AssignableTargetDto(a.UcagId, a.UcagName ?? "(unnamed NP)", "Network Partner"))
            .ToList();

        return new AssignableTargetsResponse(couriers, agents, nps);
    }

    public async Task<List<ScheduleLookupDto>> GetSchedulesLookupAsync()
    {
        // tblBulkRunSchedule is one row per (schedule, day-of-week). Group in
        // memory by (Name + Start + End + Client + Region + Speed) and expose
        // the representative id (MIN) + days list. Matches Configurator's
        // grouping semantics for the schedule picker.
        var rows = await Context.TblBulkRunSchedules
            .AsNoTracking()
            .Where(s => (s.AutoBook ?? false) == false)
            .Select(s => new
            {
                s.BulkRunScheduleId, s.Name, s.StartTime, s.EndTime,
                s.DayOfWeek, s.ClientId, s.Region, s.SpeedId
            })
            .ToListAsync();

        return rows
            .GroupBy(s => new { s.Name, s.StartTime, s.EndTime, s.ClientId, s.Region, s.SpeedId })
            .Select(g => new ScheduleLookupDto(
                g.Min(x => x.BulkRunScheduleId),
                g.Key.Name ?? string.Empty,
                g.Key.StartTime.HasValue ? g.Key.StartTime.Value.ToString(@"hh\:mm") : string.Empty,
                g.Key.EndTime.HasValue ? g.Key.EndTime.Value.ToString(@"hh\:mm") : string.Empty,
                g.Where(x => x.DayOfWeek.HasValue).Select(x => (int)x.DayOfWeek!.Value).OrderBy(x => x).ToList()))
            .OrderBy(s => s.Name)
            .ToList();
    }

    // ─── HELPERS ───────────────────────────────────────────────────────────

    private static (int? CourierId, int? AgentId) SplitTarget(byte? targetType, int? targetId)
    {
        return targetType switch
        {
            1 => (targetId, null),
            2 => (null, targetId),
            3 => (null, targetId),
            _ => (null, null),
        };
    }

    private static (int? TargetId, string TargetName) ResolveTarget(
        RouteEntity r,
        Dictionary<int, string> couriers,
        Dictionary<int, string> agents)
    {
        return r.DefaultTargetType switch
        {
            1 when r.DefaultCourierId.HasValue =>
                (r.DefaultCourierId, couriers.GetValueOrDefault(r.DefaultCourierId.Value, string.Empty)),
            2 or 3 when r.DefaultAgentId.HasValue =>
                (r.DefaultAgentId, agents.GetValueOrDefault(r.DefaultAgentId.Value, string.Empty)),
            _ => (null, string.Empty),
        };
    }

    private async Task AttachZipsAsync(RouteEntity route, List<int> zipPolygonIds)
    {
        var distinct = zipPolygonIds.Distinct().ToList();
        if (distinct.Count == 0) return;
        var found = await Context.ZipPolygons
            .Where(z => distinct.Contains(z.ZipPolygonId))
            .ToListAsync();
        foreach (var z in found) route.ZipPolygons.Add(z);
    }

    private async Task AttachCustomPolygonsAsync(RouteEntity route, List<int> customPolygonIds)
    {
        var distinct = customPolygonIds.Distinct().ToList();
        if (distinct.Count == 0) return;
        var found = await Context.CustomZipPolygons
            .Where(c => distinct.Contains(c.CustomZipPolygonId) && c.Active)
            .ToListAsync();
        foreach (var c in found) route.CustomZipPolygons.Add(c);
    }

    private static void ValidateUpsert(UpsertRouteRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            throw new InvalidOperationException("Route name is required.");
        if (req.DefaultTargetType is not (null or 1 or 2 or 3))
            throw new InvalidOperationException("DefaultTargetType must be 1, 2 or 3.");
        if (req.DefaultTargetType.HasValue && !req.DefaultTargetId.HasValue)
            throw new InvalidOperationException("DefaultTargetId is required when DefaultTargetType is set.");
    }

    private static string FormatWindow(TimeSpan? start, TimeSpan? end)
    {
        if (!start.HasValue && !end.HasValue) return string.Empty;
        var s = start.HasValue ? start.Value.ToString(@"hh\:mm") : "-";
        var e = end.HasValue ? end.Value.ToString(@"hh\:mm") : "-";
        return $"{s}-{e}";
    }

    private string CurrentUser()
    {
        var user = httpContextAccessor.HttpContext?.User;
        return user?.FindFirstValue(ClaimTypes.Email)
            ?? user?.FindFirstValue(ClaimTypes.Name)
            ?? "system";
    }
}
