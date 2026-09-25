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
            .Include(r => r.BulkRunPolygons)
            .Include(r => r.DispatchRouteRosters)
            .Include(r => r.Schedules)
            .OrderByDescending(r => r.Active)
            .ThenBy(r => r.Name)
            .ToListAsync();

        // Resolve default-target names + schedule names + counts in parallel
        // via multiple DbContexts. Sequential the 5 enrichment queries were
        // 5x the round-trip latency of the slowest one; parallel we pay
        // roughly the slowest single query. Each Task uses its own context
        // because a single DbContext isn't thread-safe.
        var courierIds = rows.Where(r => r.DefaultTargetType == 1 && r.DefaultCourierId.HasValue)
            .Select(r => r.DefaultCourierId!.Value).Distinct().ToList();
        var agentIds = rows.Where(r => r.DefaultTargetType is 2 or 3 && r.DefaultAgentId.HasValue)
            .Select(r => r.DefaultAgentId!.Value).Distinct().ToList();
        var scheduleIds = rows
            .SelectMany(r => r.Schedules.Select(s => s.BulkRunScheduleId))
            .Distinct().ToList();
        var routeIds = rows.Select(r => r.RouteId).ToList();

        var couriersTask = Task.Run(async () =>
        {
            if (courierIds.Count == 0) return new Dictionary<int, string>();
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TucCouriers.AsNoTracking()
                .Where(c => courierIds.Contains(c.UccrId))
                .ToDictionaryAsync(c => c.UccrId, c => $"{c.Code} {c.UccrName}".Trim());
        });
        var agentsTask = Task.Run(async () =>
        {
            if (agentIds.Count == 0) return new Dictionary<int, string>();
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TucAgents.AsNoTracking()
                .Where(a => agentIds.Contains(a.UcagId))
                .ToDictionaryAsync(a => a.UcagId, a => a.UcagName ?? string.Empty);
        });
        var scheduleMapTask = BuildScheduleLookupAsync(scheduleIds);
        var bookingCountsTask = Task.Run(async () =>
        {
            if (routeIds.Count == 0) return new Dictionary<int, int>();
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TucJobBookings.AsNoTracking()
                .Where(b => b.RouteId != null && routeIds.Contains(b.RouteId.Value)
                            && b.UcbkActive == true && b.UcbkDone != true)
                .GroupBy(b => b.RouteId!.Value)
                .Select(g => new { RouteId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.RouteId, x => x.Count);
        });
        var mappedStopsTask = Task.Run(async () =>
        {
            if (routeIds.Count == 0) return new Dictionary<int, int>();
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TblBulkJobs.AsNoTracking()
                .Where(j => j.RouteId != null && routeIds.Contains(j.RouteId.Value) && !j.Void)
                .GroupBy(j => j.RouteId!.Value)
                .Select(g => new { RouteId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.RouteId, x => x.Count);
        });

        await Task.WhenAll(couriersTask, agentsTask, scheduleMapTask, bookingCountsTask, mappedStopsTask);
        var couriers = couriersTask.Result;
        var agents = agentsTask.Result;
        var scheduleMap = scheduleMapTask.Result;
        var bookingCounts = bookingCountsTask.Result;
        var mappedStopsCounts = mappedStopsTask.Result;

        return rows.Select(r =>
        {
            var (targetId, targetName) = ResolveTarget(r, couriers, agents);
            var schedules = r.Schedules
                .Select(s => scheduleMap.GetValueOrDefault(s.BulkRunScheduleId))
                .Where(x => x is not null)
                .Select(x => x!)
                .OrderBy(x => x.Name)
                .ToList();
            var primary = schedules.FirstOrDefault();
            return new RouteDto(
                r.RouteId,
                r.Name ?? string.Empty,
                r.Area ?? string.Empty,
                r.DefaultTargetType,
                targetId,
                targetName,
                primary?.ScheduleId,
                primary?.Name ?? string.Empty,
                primary?.Window ?? string.Empty,
                schedules,
                r.Active,
                r.ZipPolygons
                    .OrderBy(z => z.Zip)
                    .Select(z => new RouteZipcodeDto(z.ZipPolygonId, z.Zip ?? string.Empty))
                    .ToList(),
                r.BulkRunPolygons
                    .Where(p => p.Active)
                    .OrderBy(p => p.Name)
                    .Select(p => new RouteBulkPolygonDto(
                        p.PolygonId, p.Name ?? string.Empty,
                        p.CentroidLatitude, p.CentroidLongitude))
                    .ToList(),
                r.DispatchRouteRosters.Count(rr => rr.IsActive),
                bookingCounts.GetValueOrDefault(r.RouteId),
                mappedStopsCounts.GetValueOrDefault(r.RouteId),
                r.CreatedAt,
                r.UpdatedAt);
        }).ToList();
    }

    /// <summary>Live jobs materialised on this route (Mapped Stops drill-down
    /// list). Same not-void rule as the Linehaul equivalent so the count
    /// + drill-down agree. Reuses the existing BulkJobListItemDto shape so
    /// the frontend can share the drill-down component with Linehaul.</summary>
    public async Task<List<Dtos.RecurringLinehaul.BulkJobListItemDto>> GetMappedStopsAsync(int routeId)
    {
        var q =
            from j in Context.TblBulkJobs.AsNoTracking()
            where j.RouteId == routeId && !j.Void
            join t in Context.TucJobTypes.AsNoTracking() on j.Speed equals t.UcjtId into ts
            from t in ts.DefaultIfEmpty()
            join g in Context.TucJobTypeGroupings.AsNoTracking() on t.GroupingId equals g.GroupingId into gs
            from g in gs.DefaultIfEmpty()
            join s in Context.Set<Domain.Despatch.TucJobStatus>().AsNoTracking() on j.JobStatus equals s.UcjsId into ss
            from s in ss.DefaultIfEmpty()
            orderby j.BookDate descending, j.BookTime descending
            select new Dtos.RecurringLinehaul.BulkJobListItemDto
            {
                Id = j.BulkJobId,
                JobNumber = j.JobNumber ?? string.Empty,
                Pickup = j.FromAddress,
                Drop = j.ToAddress,
                SpeedId = j.Speed,
                SpeedShortName = t == null ? string.Empty : (t.ShortName ?? string.Empty),
                SpeedName = t == null ? string.Empty : (t.UcjtName ?? string.Empty),
                SpeedGroupingId = t == null ? null : (int?)t.GroupingId,
                SpeedGroupingName = g == null ? null : g.GroupingName,
                BookDate = j.BookDate.ToString("yyyy-MM-dd"),
                BookTime = j.BookTime.ToString("HH:mm"),
                StatusName = s == null ? null : s.UcjsName
            };
        return await q.ToListAsync();
    }

    /// <summary>Live recurring bookings bound to this route (read-only).
    /// Powers the collapsible "Bookings on this route" section in the Route
    /// editor modal. Mirrors Configurator's TenantRouteService.GetBookingsAsync.</summary>
    public async Task<List<RouteBookingDto>> GetBookingsAsync(int routeId)
    {
        return await Context.TucJobBookings.AsNoTracking()
            .Where(b => b.RouteId == routeId && b.UcbkActive == true && b.UcbkDone != true)
            .OrderBy(b => b.UcbkNextDue ?? b.UcbkFirstDue ?? b.UcbkTime)
            .Take(200)
            .Select(b => new RouteBookingDto(
                b.UcbkId,
                b.UcbkClient != null ? (b.UcbkClient.UcclName ?? string.Empty) : string.Empty,
                string.Empty,   // pickup window: no start-of-window column on tucJobBooking; fill from Days/UcbkTime downstream if needed
                b.UcbkDays ?? string.Empty,
                b.UcbkNextDue ?? b.UcbkFirstDue))
            .ToListAsync();
    }

    /// <summary>Groups tblBulkRunSchedule rows (one per DoW) into a
    /// per-representative-id lookup that also aggregates the days list
    /// under each group's representative id. Mirrors the group-by used in
    /// GetSchedulesLookupAsync so the picker and the read-side agree on
    /// which id represents which group.</summary>
    private async Task<Dictionary<int, RouteScheduleDto>> BuildScheduleLookupAsync(List<int> scheduleIds)
    {
        if (scheduleIds.Count == 0) return new Dictionary<int, RouteScheduleDto>();

        // Load the identity fields for the specific schedule ids so we can
        // find each one's peer rows (same schedule, other days-of-week).
        var reps = await Context.TblBulkRunSchedules
            .AsNoTracking()
            .Where(s => scheduleIds.Contains(s.BulkRunScheduleId))
            .Select(s => new
            {
                s.BulkRunScheduleId, s.Name, s.StartTime, s.EndTime,
                s.ClientId, s.Region, s.SpeedId, s.DayOfWeek,
            })
            .ToListAsync();

        // Second pass: pull EVERY row that matches any representative's
        // group so we can list all bound days-of-week per schedule.
        var repKeys = reps
            .Select(s => new { s.Name, s.StartTime, s.EndTime, s.ClientId, s.Region, s.SpeedId })
            .Distinct()
            .ToList();
        var names = repKeys.Select(k => k.Name).Distinct().ToList();
        var siblings = await Context.TblBulkRunSchedules
            .AsNoTracking()
            .Where(s => names.Contains(s.Name))
            .Select(s => new
            {
                s.BulkRunScheduleId, s.Name, s.StartTime, s.EndTime,
                s.ClientId, s.Region, s.SpeedId, s.DayOfWeek,
            })
            .ToListAsync();
        var siblingsByKey = siblings
            .GroupBy(s => new { s.Name, s.StartTime, s.EndTime, s.ClientId, s.Region, s.SpeedId })
            .ToDictionary(
                g => g.Key,
                g => g.Where(x => x.DayOfWeek.HasValue).Select(x => (int)x.DayOfWeek!.Value).OrderBy(x => x).ToList());

        var result = new Dictionary<int, RouteScheduleDto>();
        foreach (var s in reps)
        {
            var days = siblingsByKey.GetValueOrDefault(
                new { s.Name, s.StartTime, s.EndTime, s.ClientId, s.Region, s.SpeedId },
                new List<int>());
            result[s.BulkRunScheduleId] = new RouteScheduleDto(
                s.BulkRunScheduleId,
                s.Name ?? string.Empty,
                FormatWindow(s.StartTime, s.EndTime),
                days);
        }
        return result;
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
            Active = req.Active,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = CurrentUser(),
        };
        await AttachZipsAsync(route, req.ZipPolygonIds);
        await AttachBulkPolygonsAsync(route, req.BulkPolygonIds ?? new List<int>());
        await AttachSchedulesAsync(route, req.ScheduleIds ?? new List<int>());
        Context.Routes.Add(route);
        await Context.SaveChangesAsync();
        Log.Information("Route {Id} ({Name}) created with {Zips} zip(s), {Custom} bulk polygon(s), {Scheds} schedule(s)",
            route.RouteId, route.Name, route.ZipPolygons.Count, route.BulkRunPolygons.Count, route.Schedules.Count);
        return (await GetByIdAsync(route.RouteId))!;
    }

    public async Task<RouteDto?> UpdateAsync(int id, UpsertRouteRequest req)
    {
        ValidateUpsert(req);
        var route = await Context.Routes
            .Include(r => r.ZipPolygons)
            .Include(r => r.BulkRunPolygons)
            .Include(r => r.Schedules)
            .FirstOrDefaultAsync(r => r.RouteId == id);
        if (route is null) return null;

        var (courierId, agentId) = SplitTarget(req.DefaultTargetType, req.DefaultTargetId);

        route.Name = req.Name.Trim();
        route.Area = req.Area?.Trim() ?? string.Empty;
        route.DefaultTargetType = req.DefaultTargetType;
        route.DefaultCourierId = courierId;
        route.DefaultAgentId = agentId;
        route.Active = req.Active;
        route.UpdatedAt = DateTime.UtcNow;
        route.UpdatedBy = CurrentUser();

        // Replace zip coverage wholesale (matches Configurator UPDATE contract).
        route.ZipPolygons.Clear();
        await AttachZipsAsync(route, req.ZipPolygonIds);
        // Bulk polygons: only replace if the caller sent a non-null list.
        // Null means "don't touch them" (backwards-compat with pre-Stage-3 callers).
        if (req.BulkPolygonIds is not null)
        {
            route.BulkRunPolygons.Clear();
            await AttachBulkPolygonsAsync(route, req.BulkPolygonIds);
        }
        // Schedules: same replace-wholesale semantics. Empty list clears
        // every bound schedule.
        route.Schedules.Clear();
        await AttachSchedulesAsync(route, req.ScheduleIds ?? new List<int>());

        await Context.SaveChangesAsync();
        Log.Information("Route {Id} updated ({Zips} zip(s), {Custom} bulk polygon(s), {Scheds} schedule(s))",
            id, route.ZipPolygons.Count, route.BulkRunPolygons.Count, route.Schedules.Count);
        return await GetByIdAsync(id);
    }

    public async Task<RouteDto?> CopyAsync(int sourceRouteId, CopyRouteRequest req)
    {
        var source = await Context.Routes
            .AsNoTracking()
            .Include(r => r.ZipPolygons)
            .Include(r => r.Schedules)
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
            Active = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = CurrentUser(),
        };
        if (req.CopyZipcodes && source.ZipPolygons.Count > 0)
        {
            var zipIds = source.ZipPolygons.Select(z => z.ZipPolygonId).ToList();
            await AttachZipsAsync(copy, zipIds);
        }
        // Null ScheduleIds = inherit source's bound schedules; empty list
        // = start with no schedules; non-empty = start with those.
        var scheduleIds = req.ScheduleIds
            ?? source.Schedules.Select(s => s.BulkRunScheduleId).ToList();
        await AttachSchedulesAsync(copy, scheduleIds);
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

        // Guard: the controller returns NotFound when this method returns null,
        // so surface unknown-route as null rather than orphaning a roster row.
        if (!await Context.Routes.AnyAsync(r => r.RouteId == routeId)) return null;

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

    /// <summary>
    /// Returns every zip's lightweight identity + centroid. Used by
    /// Polygon Builder to seed the on-map marker layer client-side so the
    /// operator can see every postcode at a glance without paying the
    /// per-zip WKT cost (that comes on-demand via GetPolygonShapesAsync
    /// when a marker is clicked).
    ///
    /// Payload shape matches the existing search endpoint so the
    /// frontend can reuse the ZipcodeLookup client type. On US DFRNT
    /// this is ~33k rows, roughly 400KB gzipped over the wire.
    ///
    /// Some tenants (e.g. NZ Urgent staging) have ZipPolygon rows where
    /// the Latitude / Longitude columns were never backfilled but the
    /// GeographyData column is populated. Fall back to the geography
    /// envelope centre in that case so those tenants still show
    /// postcodes on the map instead of "no postcodes on this tenant".
    /// </summary>
    public async Task<List<ZipcodeLookupDto>> GetAllZipcodeCentroidsAsync()
    {
        var rows = await Context.Database
            .SqlQueryRaw<ZipCentroidRow>(
                """
                SELECT
                    ZipPolygonID AS ZipPolygonId,
                    Zip,
                    CAST(COALESCE(Latitude,  GeographyData.EnvelopeCenter().Lat)  AS decimal(18,8)) AS Latitude,
                    CAST(COALESCE(Longitude, GeographyData.EnvelopeCenter().Long) AS decimal(18,8)) AS Longitude
                FROM dbo.ZipPolygon
                WHERE Zip IS NOT NULL
                  AND ((Latitude IS NOT NULL AND Longitude IS NOT NULL) OR GeographyData IS NOT NULL)
                ORDER BY Zip;
                """)
            .ToListAsync();

        return rows
            .Select(r => new ZipcodeLookupDto(r.ZipPolygonId, r.Zip, r.Latitude, r.Longitude))
            .ToList();
    }

    /// <summary>Row shape for the raw centroid query. Must have a parameterless
    /// constructor + settable properties for SqlQueryRaw column mapping to work
    /// (records with primary constructors are unsupported).</summary>
    public class ZipCentroidRow
    {
        public int ZipPolygonId { get; set; }
        public string Zip { get; set; } = string.Empty;
        public decimal? Latitude { get; set; }
        public decimal? Longitude { get; set; }
    }

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

    private async Task AttachBulkPolygonsAsync(RouteEntity route, List<int> bulkPolygonIds)
    {
        var distinct = bulkPolygonIds.Distinct().ToList();
        if (distinct.Count == 0) return;
        var found = await Context.BulkRunPolygons
            .Where(p => distinct.Contains(p.PolygonId) && p.Active)
            .ToListAsync();
        foreach (var p in found) route.BulkRunPolygons.Add(p);
    }

    /// <summary>Attach schedules to a route via the M:N junction. Silently
    /// drops ids that don't resolve to a real tblBulkRunSchedule row - the
    /// FK would fail at SaveChanges anyway, and the picker should never
    /// hand us a stale id in normal flow.</summary>
    private async Task AttachSchedulesAsync(RouteEntity route, List<int> scheduleIds)
    {
        var distinct = scheduleIds.Distinct().ToList();
        if (distinct.Count == 0) return;
        var found = await Context.TblBulkRunSchedules
            .Where(s => distinct.Contains(s.BulkRunScheduleId))
            .ToListAsync();
        foreach (var s in found) route.Schedules.Add(s);
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
