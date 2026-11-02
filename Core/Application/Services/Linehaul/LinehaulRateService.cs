using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Linehaul;
using RoutedOperations.Core.Domain;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Linehaul;

/// <summary>
/// Prices for linehaul runs (spec 12.2, milestone M9).
///
/// Linehaul is its own tab rather than a sub-view of Pricing because it has
/// nothing to do with a zone group: a run is a depot-to-depot leg and its
/// price hangs off the run, not off a territory. Marcus made that point on
/// 15 Oct and the zone-group banner does not appear here.
///
/// The one place this departs from the 15 Oct mock is the grid shape. The mock
/// drew runs down the side and speeds across the top, with a single price per
/// cell. The shipped table carries ScheduleId as well, and every one of the
/// 1,401 seeded rows on Urgent uses it, because the measurement found the
/// schedule explains 1,985 of 2,005 contested triples. Run 1 alone carries 223
/// schedule prices spanning $0 to $41.20, so a run-by-speed cell would have to
/// pick one of them and silently hide the rest. The tab therefore keeps the
/// mock's run rows, depot filters and speed columns for the run-level prices,
/// and lists the per-schedule prices underneath when a run is expanded.
/// </summary>
public class LinehaulRateService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    private const string AnySpeedLabel = "Any speed";

    /// <summary>Depot pairs that actually carry a run, plus the speeds that
    /// can become a column.</summary>
    public async Task<LinehaulBootstrapDto> GetBootstrapAsync()
    {
        var runs = await Context.TblbulkLinehaulRuns.AsNoTracking()
            .Select(r => new { r.FromDepotId, r.ToDepotId })
            .ToListAsync();

        var depotNames = await Context.TblBulkRegions.AsNoTracking()
            .ToDictionaryAsync(d => d.BulkRegionId, d => d.Name);

        List<LinehaulDepotOptionDto> Options(IEnumerable<int> ids) => ids
            .Distinct()
            .Select(id => new LinehaulDepotOptionDto(
                id, depotNames.TryGetValue(id, out var n) ? n : $"#{id}"))
            .OrderBy(d => d.Name)
            .ToList();

        var speeds = await Context.TucJobTypes.AsNoTracking()
            .Where(t => t.UcjtName != null)
            .OrderBy(t => t.UcjtName)
            .Select(t => new LinehaulSpeedOptionDto(t.UcjtId, t.UcjtName))
            .ToListAsync();

        return new LinehaulBootstrapDto(
            Options(runs.Select(r => r.FromDepotId)),
            Options(runs.Select(r => r.ToDepotId)),
            speeds);
    }

    /// <summary>
    /// Runs, filtered by either depot, with their run-level prices for the
    /// client being viewed. clientId null means the default sheet.
    /// </summary>
    public async Task<List<LinehaulRunRateDto>> GetRunsAsync(
        int? fromDepotId = null, int? toDepotId = null, int? clientId = null)
    {
        var runQuery = Context.TblbulkLinehaulRuns.AsNoTracking().AsQueryable();
        if (fromDepotId.HasValue) runQuery = runQuery.Where(r => r.FromDepotId == fromDepotId.Value);
        if (toDepotId.HasValue) runQuery = runQuery.Where(r => r.ToDepotId == toDepotId.Value);

        var runs = await runQuery
            .Select(r => new
            {
                r.Id, r.RunName, r.FromDepotId, r.ToDepotId, r.StartTime, r.DespatchTime,
            })
            .ToListAsync();
        if (runs.Count == 0) return [];

        var runIds = runs.Select(r => r.Id).ToList();

        var depotNames = await Context.TblBulkRegions.AsNoTracking()
            .ToDictionaryAsync(d => d.BulkRegionId, d => d.Name);

        // Every active rate on these runs for this client, in one read. Client
        // rows and default rows are both needed: a client that has no row of
        // its own inherits the default, and the grid shows which it is.
        var rates = await Context.BulkLinehaulRates.AsNoTracking()
            .Where(x => x.Active && runIds.Contains(x.LinehaulRunId)
                        && (x.ClientId == null || x.ClientId == clientId))
            .Select(x => new
            {
                x.Id, x.LinehaulRunId, x.ScheduleId, x.SpeedId, x.ClientId,
                x.Amount, x.AmountPercentage,
            })
            .ToListAsync();

        var speedNames = await Context.TucJobTypes.AsNoTracking()
            .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);

        // Schedule names for the "used by" hint. Only the ones actually priced.
        var pricedScheduleIds = rates
            .Where(x => x.ScheduleId != null)
            .Select(x => x.ScheduleId!.Value)
            .Distinct()
            .ToList();
        var scheduleNames = pricedScheduleIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.BulkRunScheduleHeaders.AsNoTracking()
                .Where(h => pricedScheduleIds.Contains(h.ScheduleId))
                .ToDictionaryAsync(h => h.ScheduleId, h => h.Name);

        var byRun = rates.GroupBy(x => x.LinehaulRunId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var result = new List<LinehaulRunRateDto>(runs.Count);
        foreach (var run in runs)
        {
            var mine = byRun.TryGetValue(run.Id, out var list) ? list : [];

            // Run-level rows only: a schedule's own price is not a column.
            var runLevel = mine.Where(x => x.ScheduleId == null).ToList();

            // Client beats default at the same speed. Picked here rather than
            // in SQL so the two passes read the same way.
            LinehaulSpeedCellDto Cell(int? speedId)
            {
                var candidates = runLevel.Where(x => x.SpeedId == speedId).ToList();
                var pick = candidates.FirstOrDefault(x => x.ClientId != null)
                           ?? candidates.FirstOrDefault();
                return new LinehaulSpeedCellDto(
                    speedId,
                    speedId == null
                        ? AnySpeedLabel
                        : speedNames.TryGetValue(speedId.Value, out var n) ? n : $"#{speedId}",
                    pick?.Id, pick?.Amount, pick?.AmountPercentage);
            }

            var speedIds = runLevel
                .Where(x => x.SpeedId != null)
                .Select(x => x.SpeedId!.Value)
                .Distinct()
                .OrderBy(id => speedNames.TryGetValue(id, out var n) ? n : $"#{id}")
                .ToList();

            var scheduleRates = mine.Where(x => x.ScheduleId != null).ToList();

            result.Add(new LinehaulRunRateDto(
                run.Id,
                run.RunName ?? $"Run {run.Id}",
                run.FromDepotId,
                depotNames.TryGetValue(run.FromDepotId, out var fd) ? fd : $"#{run.FromDepotId}",
                run.ToDepotId,
                depotNames.TryGetValue(run.ToDepotId, out var td) ? td : $"#{run.ToDepotId}",
                Hhmm(run.StartTime),
                Hhmm(run.DespatchTime),
                Cell(null),
                speedIds.Select(id => Cell(id)).ToList(),
                scheduleRates.Count,
                scheduleRates.Count == 0 ? null : scheduleRates.Min(x => x.Amount),
                scheduleRates.Count == 0 ? null : scheduleRates.Max(x => x.Amount),
                scheduleRates
                    .Select(x => scheduleNames.TryGetValue(x.ScheduleId!.Value, out var n)
                        ? n : $"#{x.ScheduleId}")
                    .Where(n => !string.IsNullOrWhiteSpace(n))
                    .Distinct()
                    .OrderBy(n => n)
                    .Take(4)
                    .ToList()));
        }

        return result.OrderBy(r => r.FromDepotName).ThenBy(r => r.ToDepotName)
            .ThenBy(r => r.RunName).ToList();
    }

    /// <summary>Every schedule price on one run, which is what the expanded
    /// row shows.</summary>
    public async Task<List<LinehaulScheduleRateDto>> GetScheduleRatesAsync(
        int runId, int? clientId = null)
    {
        var rows = await Context.BulkLinehaulRates.AsNoTracking()
            .Where(x => x.LinehaulRunId == runId && x.ScheduleId != null
                        && (x.ClientId == null || x.ClientId == clientId))
            .Select(x => new
            {
                x.Id, x.ScheduleId, x.SpeedId, x.ClientId, x.Amount,
                x.AmountPercentage, x.Active,
            })
            .ToListAsync();
        if (rows.Count == 0) return [];

        var ids = rows.Select(x => x.ScheduleId!.Value).Distinct().ToList();
        var names = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => ids.Contains(h.ScheduleId))
            .ToDictionaryAsync(h => h.ScheduleId, h => h.Name);

        var speedNames = await Context.TucJobTypes.AsNoTracking()
            .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);

        var clientCodes = await Context.TucClients.AsNoTracking()
            .Where(c => c.UcclCode != null)
            .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);

        return rows
            .Select(x => new LinehaulScheduleRateDto(
                x.Id,
                x.ScheduleId!.Value,
                names.TryGetValue(x.ScheduleId.Value, out var n) && !string.IsNullOrWhiteSpace(n)
                    ? n : $"Schedule #{x.ScheduleId}",
                x.SpeedId,
                x.SpeedId == null
                    ? AnySpeedLabel
                    : speedNames.TryGetValue(x.SpeedId.Value, out var s) ? s : $"#{x.SpeedId}",
                x.ClientId,
                x.ClientId != null && clientCodes.TryGetValue(x.ClientId.Value, out var c) ? c : null,
                x.Amount,
                x.AmountPercentage,
                x.Active))
            .OrderBy(x => x.ScheduleName)
            .ToList();
    }

    /// <summary>
    /// Set one price. Identified by the (run, schedule, speed, client) tuple,
    /// so the caller never has to know whether a row exists. Sending neither
    /// figure clears the price by deactivating the row, which keeps the id
    /// stable for anything already pointing at it.
    /// </summary>
    public async Task<LinehaulSpeedCellDto> UpsertAsync(LinehaulRateUpsertRequest req)
    {
        if (req.Amount.HasValue && req.AmountPercentage.HasValue)
            throw new InvalidOperationException(
                "A linehaul price is either a dollar amount or a percentage, not both. "
                + "Clear one of them.");
        if (req.Amount is < 0 || req.AmountPercentage is < 0)
            throw new InvalidOperationException("A linehaul price cannot be negative.");

        if (!await Context.TblbulkLinehaulRuns.AsNoTracking()
                .AnyAsync(r => r.Id == req.LinehaulRunId))
            throw new InvalidOperationException($"Linehaul run {req.LinehaulRunId} not found.");

        if (req.ClientId.HasValue
            && !await Context.TucClients.AsNoTracking().AnyAsync(c => c.UcclId == req.ClientId.Value))
            throw new InvalidOperationException($"Client {req.ClientId} not found.");

        if (req.SpeedId.HasValue
            && !await Context.TucJobTypes.AsNoTracking().AnyAsync(t => t.UcjtId == req.SpeedId.Value))
            throw new InvalidOperationException($"Speed {req.SpeedId} not found.");

        var existing = await Context.BulkLinehaulRates
            .Where(x => x.LinehaulRunId == req.LinehaulRunId
                        && x.ScheduleId == req.ScheduleId
                        && x.SpeedId == req.SpeedId
                        && x.ClientId == req.ClientId)
            .ToListAsync();

        var clearing = !req.Amount.HasValue && !req.AmountPercentage.HasValue;

        if (existing.Count == 0)
        {
            if (clearing)
                return new LinehaulSpeedCellDto(req.SpeedId, SpeedLabel(req.SpeedId), null, null, null);

            var row = new Domain.Despatch.BulkLinehaulRate
            {
                LinehaulRunId = req.LinehaulRunId,
                ScheduleId = req.ScheduleId,
                SpeedId = req.SpeedId,
                ClientId = req.ClientId,
                Amount = req.Amount,
                AmountPercentage = req.AmountPercentage,
                Active = true,
            };
            Context.BulkLinehaulRates.Add(row);
            await Context.SaveChangesAsync();
            Log.Information(
                "BulkLinehaulRate added: run {Run} schedule {Schedule} speed {Speed} client {Client}",
                req.LinehaulRunId, req.ScheduleId, req.SpeedId, req.ClientId);
            return new LinehaulSpeedCellDto(
                req.SpeedId, SpeedLabel(req.SpeedId), row.Id, row.Amount, row.AmountPercentage);
        }

        // Keep the first and retire any duplicates, so the grid cannot show
        // one figure while the rating function resolves another.
        var keep = existing[0];
        foreach (var dup in existing.Skip(1)) dup.Active = false;

        keep.Amount = req.Amount;
        keep.AmountPercentage = req.AmountPercentage;
        keep.Active = !clearing;
        await Context.SaveChangesAsync();

        return new LinehaulSpeedCellDto(
            req.SpeedId,
            SpeedLabel(req.SpeedId),
            clearing ? null : keep.Id,
            clearing ? null : keep.Amount,
            clearing ? null : keep.AmountPercentage);

        string SpeedLabel(int? id) => id == null ? AnySpeedLabel : $"#{id}";
    }

    /// <summary>
    /// Add a priced speed column to a run, seeded from its any-speed price so
    /// the new column starts where the operator expects rather than empty.
    /// This is the control Marcus found missing on 15 Oct.
    /// </summary>
    public async Task<LinehaulSpeedCellDto> AddSpeedColumnAsync(
        int runId, int speedId, int? clientId = null)
    {
        var anySpeed = await Context.BulkLinehaulRates.AsNoTracking()
            .Where(x => x.Active && x.LinehaulRunId == runId && x.ScheduleId == null
                        && x.SpeedId == null && x.ClientId == clientId)
            .Select(x => new { x.Amount, x.AmountPercentage })
            .FirstOrDefaultAsync();

        return await UpsertAsync(new LinehaulRateUpsertRequest
        {
            LinehaulRunId = runId,
            ScheduleId = null,
            SpeedId = speedId,
            ClientId = clientId,
            // Seeded, not copied blindly: with no any-speed price the column
            // starts empty rather than at zero, which would be a real price.
            Amount = anySpeed?.Amount,
            AmountPercentage = anySpeed?.AmountPercentage,
        });
    }

    private static string Hhmm(TimeOnly? t) =>
        t.HasValue ? $"{t.Value.Hour:D2}:{t.Value.Minute:D2}" : null;
}
