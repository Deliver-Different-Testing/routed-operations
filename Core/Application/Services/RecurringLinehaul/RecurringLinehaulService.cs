using System.Globalization;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.RecurringLinehaul;

/// <summary>
/// Tenant-side CRUD for linehaul (depot-to-depot middle-mile) runs — the
/// Linehaul + Linehaul Roster tabs on Recurring Routes. Port of the Configurator
/// TenantLinehaulService (spec §3, §4 + Fixes §5-8). Reads/writes the shared
/// Despatch tables tblbulkLinehaulRun + Dispatch_LinehaulRunRoster + related
/// TucJobBooking columns; enriches each row with depot names, default-target
/// name (Courier/Agent/NP), live Mapped Stops count and Used-by-Schedules count.
/// </summary>
public class RecurringLinehaulService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    private const byte ModeRoad = 1;
    private const byte ModeFlight = 2;

    // ── Linehaul run CRUD ─────────────────────────────────────────────────

    public async Task<List<RecurringLinehaulRunDto>> ListAsync()
    {
        var runs = await Context.TblbulkLinehaulRuns.AsNoTracking()
            .OrderBy(r => r.RunName)
            .ToListAsync();
        return await EnrichAsync(runs);
    }

    public async Task<RecurringLinehaulRunDto?> GetAsync(int id)
    {
        var run = await Context.TblbulkLinehaulRuns.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id);
        if (run is null) return null;
        return (await EnrichAsync([run])).Single();
    }

    public async Task<RecurringLinehaulLookupsDto> GetLookupsAsync()
    {
        var depots = await Context.TblBulkRegions.AsNoTracking()
            .Where(d => d.Active == true)
            .OrderBy(d => d.Name)
            .Select(d => new RecurringLinehaulDepotLookupDto { Id = d.BulkRegionId, Name = d.Name ?? string.Empty })
            .ToListAsync();

        var couriers = await Context.TucCouriers.AsNoTracking()
            .Where(c => c.Active)
            .OrderBy(c => c.UccrName).ThenBy(c => c.UccrSurname)
            .Select(c => new RecurringLinehaulCourierLookupDto
            {
                Id = c.UccrId,
                Name = (c.UccrName + " " + c.UccrSurname).Trim(),
                Code = c.Code ?? string.Empty
            })
            .ToListAsync();

        return new RecurringLinehaulLookupsDto { Depots = depots, Couriers = couriers };
    }

    // ── Master-job linking (STEVE-LINEHAUL-RUN-MODAL-MASTER-JOB) ──────────

    public async Task<List<RecurringLinehaulBookingLookupDto>> SearchLinkableBookingsAsync(int runId, string? q)
    {
        var term = (q ?? string.Empty).Trim();
        if (term.Length < 2) return [];

        return await Context.TucJobBookings.AsNoTracking()
            .Where(b => b.UcbkActive == true && b.ParentId == null)
            .Where(b =>
                b.UcbkJobNumber.Contains(term) ||
                (b.CustomJobName != null && b.CustomJobName.Contains(term)) ||
                (b.UcbkClient != null && b.UcbkClient.UcclName != null && b.UcbkClient.UcclName.Contains(term)) ||
                (b.FromAddressStreetName != null && b.FromAddressStreetName.Contains(term)) ||
                (b.ToAddressStreetName != null && b.ToAddressStreetName.Contains(term)) ||
                (b.PickupAddressLine1 != null && b.PickupAddressLine1.Contains(term)) ||
                (b.DeliveryAddressLine1 != null && b.DeliveryAddressLine1.Contains(term)))
            .OrderByDescending(b => b.UcbkJobNumber == term)
            .ThenByDescending(b => b.UcbkJobNumber.StartsWith(term))
            .ThenByDescending(b => b.UcbkTime)
            .Take(50)
            .Select(b => new RecurringLinehaulBookingLookupDto
            {
                BookingId = b.UcbkId,
                JobNumber = b.UcbkJobNumber ?? string.Empty,
                JobName = b.CustomJobName,
                ClientName = b.UcbkClient != null ? b.UcbkClient.UcclName : null,
                PickupSummary = b.PickupAddressLine1,
                DeliverySummary = b.DeliveryAddressLine1,
                LinkedRunId = b.LinehaulRunId,
                IsMaster = b.IsLinehaulMaster,
                LinkedToThisRun = b.LinehaulRunId == runId
            })
            .ToListAsync();
    }

    // Single-master invariant on save (Configurator P0-B). Demote any current
    // master for this run; then promote the selected booking + inherit the run
    // courier so the realised master LH job dispatches to the run courier.
    private async Task ApplyMasterBookingAsync(int runId, int? masterBookingId, int? runCourierId)
    {
        var current = await Context.TucJobBookings
            .Where(b => b.LinehaulRunId == runId && b.IsLinehaulMaster)
            .ToListAsync();

        foreach (var b in current.Where(b => b.UcbkId != masterBookingId))
        {
            b.IsLinehaulMaster = false;
            b.LinehaulRunId = null;
            b.CourierId = null;
        }

        if (masterBookingId is { } id)
        {
            var booking = current.FirstOrDefault(b => b.UcbkId == id)
                ?? await Context.TucJobBookings.FirstOrDefaultAsync(b => b.UcbkId == id);
            if (booking is not null)
            {
                booking.LinehaulRunId = runId;
                booking.IsLinehaulMaster = true;
                booking.CourierId = runCourierId;
            }
        }
    }

    public async Task<RecurringLinehaulMutationResult> CreateAsync(RecurringLinehaulRunUpsertDto dto)
    {
        var error = await ValidateAsync(dto, null);
        if (error is not null) return RecurringLinehaulMutationResult.Invalid(error);

        var (targetType, courierId, agentId) = MapTarget(dto.DefaultTargetType, dto.DefaultTargetId);
        var run = new TblbulkLinehaulRun
        {
            RunName = dto.RunName!.Trim(),
            FromDepotId = dto.FromDepotId,
            ToDepotId = dto.ToDepotId,
            StartTime = ParseTime(dto.StartTime),
            DespatchTime = ParseTime(dto.DespatchTime),
            DefaultTargetType = targetType,
            CourierId = courierId,
            DefaultAgentId = agentId,
            SpeedId = dto.SpeedId,
            Mode = NormalizeMode(dto.Mode)
        };
        Context.TblbulkLinehaulRuns.Add(run);
        await Context.SaveChangesAsync();

        if (dto.MasterBookingId is not null)
        {
            await ApplyMasterBookingAsync(run.Id, dto.MasterBookingId, run.CourierId);
            await Context.SaveChangesAsync();
        }

        return RecurringLinehaulMutationResult.Ok((await EnrichAsync([run])).Single());
    }

    public async Task<RecurringLinehaulMutationResult> UpdateAsync(int id, RecurringLinehaulRunUpsertDto dto)
    {
        var run = await Context.TblbulkLinehaulRuns.FirstOrDefaultAsync(r => r.Id == id);
        if (run is null) return RecurringLinehaulMutationResult.NotFoundResult();

        var error = await ValidateAsync(dto, id);
        if (error is not null) return RecurringLinehaulMutationResult.Invalid(error);

        var (targetType, courierId, agentId) = MapTarget(dto.DefaultTargetType, dto.DefaultTargetId);
        run.RunName = dto.RunName!.Trim();
        run.FromDepotId = dto.FromDepotId;
        run.ToDepotId = dto.ToDepotId;
        run.StartTime = ParseTime(dto.StartTime);
        run.DespatchTime = ParseTime(dto.DespatchTime);
        run.DefaultTargetType = targetType;
        run.CourierId = courierId;
        run.DefaultAgentId = agentId;
        run.SpeedId = dto.SpeedId;
        run.Mode = NormalizeMode(dto.Mode);
        await ApplyMasterBookingAsync(run.Id, dto.MasterBookingId, run.CourierId);
        await Context.SaveChangesAsync();

        return RecurringLinehaulMutationResult.Ok((await EnrichAsync([run])).Single());
    }

    public async Task<RecurringLinehaulMutationResult> DeleteAsync(int id)
    {
        var run = await Context.TblbulkLinehaulRuns.FirstOrDefaultAsync(r => r.Id == id);
        if (run is null) return RecurringLinehaulMutationResult.NotFoundResult();

        var activeBindings = await Context.TblBulkScheduleLinehauls.AsNoTracking()
            .CountAsync(s => s.LinehaulRunId == id && s.Active == true);
        if (activeBindings > 0) return RecurringLinehaulMutationResult.Blocked();

        Context.TblbulkLinehaulRuns.Remove(run);
        await Context.SaveChangesAsync();
        return new RecurringLinehaulMutationResult();
    }

    public async Task<RecurringLinehaulMutationResult> CopyAsync(int id)
    {
        var src = await Context.TblbulkLinehaulRuns.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id);
        if (src is null) return RecurringLinehaulMutationResult.NotFoundResult();

        var baseName = $"{src.RunName} (copy)";
        var name = baseName;
        var n = 2;
        while (await Context.TblbulkLinehaulRuns.AnyAsync(r => r.RunName == name))
        {
            name = $"{baseName} {n++}";
        }

        var copy = new TblbulkLinehaulRun
        {
            RunName = name.Length > 50 ? name[..50] : name,
            FromDepotId = src.FromDepotId,
            ToDepotId = src.ToDepotId,
            StartTime = src.StartTime,
            DespatchTime = src.DespatchTime,
            DefaultTargetType = src.DefaultTargetType,
            CourierId = src.CourierId,
            DefaultAgentId = src.DefaultAgentId,
            SpeedId = src.SpeedId,
            Mode = src.Mode == 0 ? ModeRoad : src.Mode
        };
        Context.TblbulkLinehaulRuns.Add(copy);
        await Context.SaveChangesAsync();

        return RecurringLinehaulMutationResult.Ok((await EnrichAsync([copy])).Single());
    }

    // ── Schedule bindings drill-down (Fix 7 + 2026-06-19 dedupe) ─────────

    public async Task<List<RecurringLinehaulScheduleBindingDto>> GetScheduleBindingsAsync(int runId)
    {
        var rows = await Context.TblBulkScheduleLinehauls.AsNoTracking()
            .Where(s => s.LinehaulRunId == runId && s.Active == true)
            .Select(s => new
            {
                s.BulkRunScheduleId,
                BindingName = s.Name,
                SchedName = s.BulkRunSchedule != null ? s.BulkRunSchedule.Name : null,
                ClientId = s.BulkRunSchedule != null ? s.BulkRunSchedule.ClientId : null,
                DayOfWeek = s.BulkRunSchedule != null ? (short?)s.BulkRunSchedule.DayOfWeek : null
            })
            .ToListAsync();

        return rows
            .GroupBy(r => r.SchedName != null ? $"s|{r.SchedName}|{r.ClientId}" : $"b|{r.BindingName}")
            .Select(g =>
            {
                var first = g.First();
                var days = g.Where(x => x.DayOfWeek.HasValue)
                    .Select(x => (int)x.DayOfWeek!.Value).Distinct().OrderBy(d => d)
                    .Select(WeekdayShort).ToList();
                return new RecurringLinehaulScheduleBindingDto
                {
                    ScheduleId = g.Min(x => x.BulkRunScheduleId),
                    Name = !string.IsNullOrWhiteSpace(first.SchedName) ? first.SchedName!
                         : !string.IsNullOrWhiteSpace(first.BindingName) ? first.BindingName!
                         : "(unnamed schedule)",
                    Active = true,
                    WeekDay = days.Count > 0 ? string.Join(", ", days) : null
                };
            })
            .OrderBy(d => d.Name)
            .ToList();
    }

    private static string WeekdayShort(int dow) => dow switch
    {
        1 => "Mon", 2 => "Tue", 3 => "Wed", 4 => "Thu", 5 => "Fri", 6 => "Sat", 7 => "Sun", 0 => "Sun",
        _ => dow.ToString()
    };

    // ── Roster (spec 4 + Fixes 6) ─────────────────────────────────────────

    public async Task<LinehaulRosterGridDto> GetRosterGridAsync()
    {
        var runs = await Context.TblbulkLinehaulRuns.AsNoTracking().OrderBy(r => r.RunName).ToListAsync();
        var enriched = await EnrichAsync(runs);
        var runIds = runs.Select(r => r.Id).ToList();

        var cells = await Context.DispatchLinehaulRunRosters.AsNoTracking()
            .Where(x => x.IsActive && x.RosterDate == null && x.DayOfWeek != null && runIds.Contains(x.LinehaulRunId))
            .ToListAsync();

        var courierNames = await ResolveCourierNamesAsync(
            cells.Where(c => c.CourierId.HasValue).Select(c => c.CourierId!.Value));
        var agents = await ResolveAgentsAsync(
            cells.Where(c => c.AgentId.HasValue).Select(c => c.AgentId!.Value));

        var cellsByRun = cells
            .GroupBy(c => c.LinehaulRunId)
            .ToDictionary(g => g.Key, g => g.Select(c =>
            {
                var type = TargetTypeName(c.TargetType) ?? (c.CourierId.HasValue ? "Courier" : null);
                var (targetId, targetName, targetHint) = ResolveTarget(type, c.CourierId, c.AgentId, courierNames, agents);
                return new LinehaulRosterCellDto
                {
                    RosterId = c.LinehaulRunRosterId,
                    DayOfWeek = c.DayOfWeek!.Value,
                    CourierId = c.CourierId,
                    CourierName = c.CourierId.HasValue ? courierNames.GetValueOrDefault(c.CourierId.Value).Name : null,
                    TargetType = type,
                    TargetId = targetId,
                    TargetName = targetName,
                    TargetHint = targetHint
                };
            }).ToList());

        var rows = enriched.Select(e => new LinehaulRosterRowDto
        {
            RunId = e.Id,
            RunName = e.RunName,
            FromDepotName = e.FromDepotName,
            ToDepotName = e.ToDepotName,
            DefaultCourierId = e.CourierId,
            DefaultDriverName = e.DefaultDriverName,
            DefaultTargetType = e.DefaultTargetType,
            DefaultTargetId = e.DefaultTargetId,
            DefaultTargetName = e.DefaultTargetName,
            DefaultTargetHint = e.DefaultTargetHint,
            Active = e.Active,
            Cells = cellsByRun.GetValueOrDefault(e.Id) ?? []
        }).ToList();

        var couriers = (await GetLookupsAsync()).Couriers;
        return new LinehaulRosterGridDto { Rows = rows, Couriers = couriers };
    }

    public async Task<LinehaulRosterCellDto?> UpsertRosterCellAsync(LinehaulRosterUpsertDto dto)
    {
        if (dto.DayOfWeek is < 1 or > 7) return null;

        var (targetType, courierId, agentId) = MapTarget(dto.TargetType, dto.TargetId);
        if (targetType is null || dto.TargetId <= 0) return null;

        if (!await Context.TblbulkLinehaulRuns.AnyAsync(r => r.Id == dto.LinehaulRunId)) return null;

        var existing = await Context.DispatchLinehaulRunRosters
            .Where(x => x.IsActive && x.RosterDate == null
                        && x.LinehaulRunId == dto.LinehaulRunId && x.DayOfWeek == (byte)dto.DayOfWeek)
            .ToListAsync();
        foreach (var e in existing) e.IsActive = false;

        var row = new DispatchLinehaulRunRoster
        {
            LinehaulRunId = dto.LinehaulRunId,
            TargetType = targetType,
            CourierId = courierId,
            AgentId = agentId,
            DayOfWeek = (byte)dto.DayOfWeek,
            RosterDate = null,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = "routed-operations"
        };
        Context.DispatchLinehaulRunRosters.Add(row);
        await Context.SaveChangesAsync();

        var type = TargetTypeName(targetType);
        var courierNames = await ResolveCourierNamesAsync(courierId.HasValue ? [courierId.Value] : []);
        var agents = await ResolveAgentsAsync(agentId.HasValue ? [agentId.Value] : []);
        var (targetId, targetName, targetHint) = ResolveTarget(type, courierId, agentId, courierNames, agents);
        return new LinehaulRosterCellDto
        {
            RosterId = row.LinehaulRunRosterId,
            DayOfWeek = dto.DayOfWeek,
            CourierId = courierId,
            CourierName = courierId.HasValue ? courierNames.GetValueOrDefault(courierId.Value).Name : null,
            TargetType = type,
            TargetId = targetId,
            TargetName = targetName,
            TargetHint = targetHint
        };
    }

    public async Task<bool> DeleteRosterCellAsync(int rosterId)
    {
        var row = await Context.DispatchLinehaulRunRosters.FirstOrDefaultAsync(x => x.LinehaulRunRosterId == rosterId);
        if (row is null) return false;

        row.IsActive = false;
        await Context.SaveChangesAsync();
        return true;
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private async Task<string?> ValidateAsync(RecurringLinehaulRunUpsertDto dto, int? id)
    {
        var name = dto.RunName?.Trim();
        if (string.IsNullOrWhiteSpace(name)) return "Run name is required.";
        if (name.Length > 50) return "Run name must be 50 characters or fewer.";
        if (dto.FromDepotId <= 0 || dto.ToDepotId <= 0) return "From and To depots are required.";
        if (dto.FromDepotId == dto.ToDepotId) return "From and To depots must be different.";

        var start = ParseTime(dto.StartTime);
        var despatch = ParseTime(dto.DespatchTime);
        if (start.HasValue && despatch.HasValue && despatch.Value < start.Value)
        {
            return "Despatch time must be at or after the start time.";
        }

        var dupe = await Context.TblbulkLinehaulRuns.AsNoTracking()
            .AnyAsync(r => r.RunName == name && (id == null || r.Id != id));
        if (dupe) return $"A linehaul run named \"{name}\" already exists.";

        if (NormalizeMode(dto.Mode) == ModeFlight)
        {
            if (dto.SpeedId is null or <= 0)
            {
                return "A Flight-mode run needs a Flight service level - pick one under Speed (service level).";
            }
            if (!await IsFlightGroupedSpeedAsync(dto.SpeedId.Value))
            {
                return "The selected speed isn't a Flight service level. A Flight-mode run must use a speed in the Flight grouping.";
            }
        }
        return null;
    }

    private async Task<bool> IsFlightGroupedSpeedAsync(int speedId)
    {
        var groupingName = await (
            from jt in Context.TucJobTypes.AsNoTracking()
            join g in Context.TucJobTypeGroupings.AsNoTracking() on jt.GroupingId equals g.GroupingId
            where jt.UcjtId == speedId
            select g.GroupingName).FirstOrDefaultAsync();
        return groupingName is not null
            && groupingName.Contains("flight", StringComparison.OrdinalIgnoreCase);
    }

    private async Task<List<RecurringLinehaulRunDto>> EnrichAsync(List<TblbulkLinehaulRun> runs)
    {
        if (runs.Count == 0) return [];

        var runIds = runs.Select(r => r.Id).ToList();
        var depotIds = runs.SelectMany(r => new[] { r.FromDepotId, r.ToDepotId }).Distinct().ToList();
        var courierIds = runs.Where(r => r.CourierId > 0).Select(r => r.CourierId!.Value).Distinct().ToList();
        var agentIds = runs.Where(r => r.DefaultAgentId.HasValue).Select(r => r.DefaultAgentId!.Value).Distinct().ToList();

        // Parallelize 6 independent enrichment reads. Each task uses its own
        // DbContext because a single DbContext isn't thread-safe. Cuts the
        // 6 sequential round trips (~50ms each on a busy network) down to
        // roughly the slowest single query. Biggest win when N runs is large.
        var depotTask = Task.Run(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TblBulkRegions.AsNoTracking()
                .Where(d => depotIds.Contains(d.BulkRegionId))
                .ToDictionaryAsync(d => d.BulkRegionId, d => d.Name ?? string.Empty);
        });
        var courierTask = Task.Run<Dictionary<int, (string Name, string Code)>>(async () =>
        {
            if (courierIds.Count == 0) return new Dictionary<int, (string Name, string Code)>();
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return (await ctx.TucCouriers.AsNoTracking()
                    .Where(c => courierIds.Contains(c.UccrId))
                    .Select(c => new { c.UccrId, c.UccrName, c.UccrSurname, c.Code })
                    .ToListAsync())
                .ToDictionary(c => c.UccrId,
                    c => (Name: (c.UccrName + " " + c.UccrSurname).Trim(), Code: c.Code ?? string.Empty));
        });
        var agentTask = Task.Run<Dictionary<int, (string Name, string Hint)>>(async () =>
        {
            if (agentIds.Count == 0) return new Dictionary<int, (string Name, string Hint)>();
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return (await ctx.TucAgents.AsNoTracking()
                    .Where(a => agentIds.Contains(a.UcagId))
                    .Select(a => new { a.UcagId, a.UcagName, a.Association })
                    .ToListAsync())
                .ToDictionary(a => a.UcagId,
                    a => (Name: a.UcagName ?? string.Empty, Hint: a.Association ?? string.Empty));
        });
        var stopCountsTask = Task.Run(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TblBulkJobs.AsNoTracking()
                .Where(j => j.LinehaulRunId != null && runIds.Contains(j.LinehaulRunId.Value) && !j.Void)
                .GroupBy(j => j.LinehaulRunId!.Value)
                .Select(g => new { RunId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.RunId, x => x.Count);
        });
        var bindingRowsTask = Task.Run(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TblBulkScheduleLinehauls.AsNoTracking()
                .Where(s => s.LinehaulRunId != null && runIds.Contains(s.LinehaulRunId.Value) && s.Active == true)
                .Select(s => new
                {
                    RunId = s.LinehaulRunId!.Value,
                    SchedName = s.BulkRunSchedule != null ? s.BulkRunSchedule.Name : null,
                    ClientId = s.BulkRunSchedule != null ? s.BulkRunSchedule.ClientId : null,
                    BindingName = s.Name
                })
                .ToListAsync();
        });
        var mastersTask = Task.Run(async () =>
        {
            await using var ctx = await contextFactory.CreateDbContextAsync();
            return await ctx.TucJobBookings.AsNoTracking()
                .Where(b => b.LinehaulRunId != null && runIds.Contains(b.LinehaulRunId.Value) && b.IsLinehaulMaster)
                .Select(b => new
                {
                    RunId = b.LinehaulRunId!.Value,
                    b.UcbkId,
                    b.UcbkJobNumber,
                    b.CustomJobName,
                    ClientName = b.UcbkClient != null ? b.UcbkClient.UcclName : null
                })
                .ToListAsync();
        });

        await Task.WhenAll(depotTask, courierTask, agentTask, stopCountsTask, bindingRowsTask, mastersTask);
        var depotNames = depotTask.Result;
        var courierNames = courierTask.Result;
        var agents = agentTask.Result;
        var stopCounts = stopCountsTask.Result;
        var bindingRows = bindingRowsTask.Result;
        var activeBindingCounts = bindingRows
            .GroupBy(r => r.RunId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(r => r.SchedName != null ? $"s|{r.SchedName}|{r.ClientId}" : $"b|{r.BindingName}")
                    .Distinct().Count());
        var masters = mastersTask.Result
            .GroupBy(m => m.RunId)
            .ToDictionary(g => g.Key, g => g.First());

        return runs.Select(r =>
        {
            var usedBy = activeBindingCounts.GetValueOrDefault(r.Id);
            var master = masters.GetValueOrDefault(r.Id);
            var type = TargetTypeName(r.DefaultTargetType) ?? (r.CourierId > 0 ? "Courier" : null);
            var (targetId, targetName, targetHint) = ResolveTarget(type, r.CourierId > 0 ? r.CourierId : null, r.DefaultAgentId, courierNames, agents);
            return new RecurringLinehaulRunDto
            {
                Id = r.Id,
                RunName = r.RunName ?? string.Empty,
                FromDepotId = r.FromDepotId,
                ToDepotId = r.ToDepotId,
                FromDepotName = depotNames.GetValueOrDefault(r.FromDepotId, string.Empty),
                ToDepotName = depotNames.GetValueOrDefault(r.ToDepotId, string.Empty),
                StartTime = FormatTime(r.StartTime),
                DespatchTime = FormatTime(r.DespatchTime),
                CourierId = r.CourierId > 0 ? r.CourierId : null,
                DefaultDriverName = r.CourierId > 0 ? courierNames.GetValueOrDefault(r.CourierId!.Value).Name : null,
                DefaultAgentId = r.DefaultAgentId,
                DefaultTargetType = type,
                DefaultTargetId = targetId,
                DefaultTargetName = targetName,
                DefaultTargetHint = targetHint,
                SpeedId = r.SpeedId,
                Mode = r.Mode == 0 ? ModeRoad : r.Mode,
                MasterBookingId = master?.UcbkId,
                MasterBookingLabel = master is null ? null : BookingLabel(master.UcbkJobNumber, master.CustomJobName, master.ClientName),
                MappedStopsCount = stopCounts.GetValueOrDefault(r.Id),
                UsedBySchedulesCount = usedBy,
                Active = usedBy > 0
            };
        }).ToList();
    }

    private static string BookingLabel(string? jobNo, string? jobName, string? client)
    {
        var primary = string.IsNullOrWhiteSpace(jobNo) ? "(no job #)" : jobNo!.Trim();
        var secondary = !string.IsNullOrWhiteSpace(jobName) ? jobName!.Trim()
            : !string.IsNullOrWhiteSpace(client) ? client!.Trim() : null;
        return secondary is null ? primary : $"{primary} - {secondary}";
    }

    private static (byte? Type, int? CourierId, int? AgentId) MapTarget(string? type, int? id) => type switch
    {
        "Courier" => ((byte?)1, id, null),
        "Agent" => ((byte?)2, null, id),
        "NetworkPartner" => ((byte?)3, null, id),
        _ => (null, null, null)
    };

    private static string? TargetTypeName(byte? type) => type switch
    {
        1 => "Courier",
        2 => "Agent",
        3 => "NetworkPartner",
        _ => null
    };

    private async Task<Dictionary<int, (string Name, string Code)>> ResolveCourierNamesAsync(IEnumerable<int> ids)
    {
        var idList = ids.Distinct().ToList();
        if (idList.Count == 0) return [];

        return (await Context.TucCouriers.AsNoTracking()
                .Where(c => idList.Contains(c.UccrId))
                .Select(c => new { c.UccrId, c.UccrName, c.UccrSurname, c.Code })
                .ToListAsync())
            .ToDictionary(c => c.UccrId, c => ((c.UccrName + " " + c.UccrSurname).Trim(), c.Code ?? string.Empty));
    }

    private async Task<Dictionary<int, (string Name, string Hint)>> ResolveAgentsAsync(IEnumerable<int> ids)
    {
        var idList = ids.Distinct().ToList();
        if (idList.Count == 0) return [];

        return (await Context.TucAgents.AsNoTracking()
                .Where(a => idList.Contains(a.UcagId))
                .Select(a => new { a.UcagId, a.UcagName, a.Association })
                .ToListAsync())
            .ToDictionary(a => a.UcagId, a => (a.UcagName ?? string.Empty, a.Association ?? string.Empty));
    }

    private static (int? Id, string? Name, string? Hint) ResolveTarget(
        string? type, int? courierId, int? agentId,
        Dictionary<int, (string Name, string Code)> couriers,
        Dictionary<int, (string Name, string Hint)> agents) => type switch
    {
        "Courier" when courierId.HasValue =>
            (courierId, couriers.GetValueOrDefault(courierId.Value).Name, couriers.GetValueOrDefault(courierId.Value).Code),
        "Agent" or "NetworkPartner" when agentId.HasValue =>
            (agentId, agents.GetValueOrDefault(agentId.Value).Name, agents.GetValueOrDefault(agentId.Value).Hint),
        _ => (null, null, null)
    };

    private static TimeOnly? ParseTime(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return TimeOnly.TryParse(value, CultureInfo.InvariantCulture, out var t) ? t : null;
    }

    private static string? FormatTime(TimeOnly? value) => value?.ToString("HH:mm", CultureInfo.InvariantCulture);

    private static byte NormalizeMode(byte? mode) => mode == ModeFlight ? ModeFlight : ModeRoad;
}
