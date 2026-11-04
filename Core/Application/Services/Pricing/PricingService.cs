using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Pricing;
using RoutedOperations.Core.Domain;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Pricing;

/// <summary>
/// The Pricing tab (spec 3.3, milestone M8): zone rates, dimension bands,
/// surcharges and offered speeds, for one zone group and one client.
///
/// **How a rate is found, and why it is not yet by zone group.** The target
/// model hangs prices off the zone group, and Phase 1A added
/// BulkZoneRate.PostcodeGroupId for it, but the backfill left that column NULL
/// on all 5,323 rows on Urgent. Prices are still identified by
/// (DepotId, Zone, SpeedId, ClientId): Auckland alone holds 1,736 active rows
/// over 10 zones, 30 speeds and 193 clients. So a group-keyed read would
/// return an empty grid on every group today.
///
/// This service therefore matches a row when EITHER its PostcodeGroupId is the
/// group being viewed, OR its PostcodeGroupId is NULL and its DepotId is the
/// group's depot. Writes stamp both columns, so the group column fills in as
/// prices are edited and the depot fallback quietly stops mattering, with no
/// second backfill and no code change when Phase 2 lands. The grid reports
/// which path it used so the screen can say so rather than implying the rates
/// are already group-scoped.
///
/// **Inheritance.** A client cell shows the client's own row when it has one
/// (rendered black by the grid) and the default row otherwise (grey). This is
/// the opposite of the dimension-band rule below, which is why the two are
/// never described with the same words on screen.
/// </summary>
public class PricingService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    // ─── BOOTSTRAP ─────────────────────────────────────────────────────────

    public async Task<PricingBootstrapDto> GetBootstrapAsync()
    {
        var depotNames = await Context.TblBulkRegions.AsNoTracking()
            .ToDictionaryAsync(d => d.BulkRegionId, d => d.Name);

        var groups = (await Context.BulkZonePostcodeGroups.AsNoTracking()
                .Select(g => new { g.Id, g.Name, g.DepotId, g.ClientId })
                .ToListAsync())
            .Select(g => new PricingGroupOptionDto(
                g.Id, g.Name, g.DepotId,
                g.DepotId != null && depotNames.TryGetValue(g.DepotId.Value, out var d) ? d : null,
                g.ClientId))
            .OrderBy(g => g.Name)
            .ToList();

        var speeds = await Context.TucJobTypes.AsNoTracking()
            .Where(t => t.UcjtName != null)
            .OrderBy(t => t.UcjtName)
            .Select(t => new RateSpeedColumnDto(t.UcjtId, t.UcjtName))
            .ToListAsync();

        var sheets = await Context.BulkZoneRateSheets.AsNoTracking()
            .Where(s => s.Active)
            .OrderBy(s => s.Name)
            .Select(s => new RateSheetDto(s.Id, s.PostcodeGroupId, s.Name, s.IsDefault, s.CourierPayHere))
            .ToListAsync();

        var sets = await Context.BulkZonePackageRateSets.AsNoTracking()
            .Where(s => s.Active)
            .OrderBy(s => s.Name)
            .Select(s => new RateSetDto(s.Id, s.Name, s.IsDefault))
            .ToListAsync();

        return new PricingBootstrapDto(groups, speeds, sheets, sets);
    }

    // ─── ZONE RATES ────────────────────────────────────────────────────────

    public async Task<ZoneRateGridDto> GetZoneRatesAsync(int postcodeGroupId, int? clientId = null)
    {
        var group = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .FirstOrDefaultAsync(g => g.Id == postcodeGroupId)
            ?? throw new InvalidOperationException("Postcode group not found.");

        var depotName = group.DepotId == null
            ? null
            : await Context.TblBulkRegions.AsNoTracking()
                .Where(d => d.BulkRegionId == group.DepotId)
                .Select(d => d.Name)
                .FirstOrDefaultAsync();

        var rows = await RatesForGroupAsync(postcodeGroupId, group.DepotId, clientId);

        // Zones come from the group's membership, not from the rates, so a
        // zone nobody has priced yet still gets a row to type into.
        var memberZones = await Context.BulkZonePostcodes.AsNoTracking()
            .Where(p => p.PostcodeGroupId == postcodeGroupId)
            .Select(p => p.Zone)
            .Distinct()
            .ToListAsync();
        var zones = memberZones
            .Concat(rows.Select(r => r.Zone))
            .Distinct()
            .OrderBy(z => z)
            .ToList();

        var speedIds = rows
            .Where(r => r.SpeedId != null)
            .Select(r => r.SpeedId!.Value)
            .Distinct()
            .ToList();
        var speedNames = speedIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.TucJobTypes.AsNoTracking()
                .Where(t => speedIds.Contains(t.UcjtId))
                .ToDictionaryAsync(t => t.UcjtId, t => t.UcjtName);

        var speeds = speedIds
            .Select(id => new RateSpeedColumnDto(
                id, speedNames.TryGetValue(id, out var n) && !string.IsNullOrWhiteSpace(n) ? n : $"Speed #{id}"))
            .OrderBy(s => s.Name)
            .ToList();

        var cells = new List<RateCellDto>();
        var overridden = 0;
        foreach (var zone in zones)
        {
            foreach (var speed in speeds)
            {
                var atCell = rows.Where(r => r.Zone == zone && r.SpeedId == speed.SpeedId).ToList();
                var mine = clientId == null
                    ? null
                    : atCell.FirstOrDefault(r => r.ClientId == clientId);
                var fallback = atCell.FirstOrDefault(r => r.ClientId == null);
                var shown = mine ?? fallback;
                if (shown == null) continue;

                var inherited = mine == null;
                if (!inherited && clientId != null) overridden++;

                cells.Add(new RateCellDto(
                    zone, speed.SpeedId, shown.Id, shown.Amount, shown.CourierPercentage,
                    inherited, fallback?.Amount));
            }
        }

        var byDepot = rows.Count > 0 && rows.All(r => r.PostcodeGroupId == null);

        return new ZoneRateGridDto(
            postcodeGroupId,
            group.Name,
            group.DepotId,
            depotName,
            clientId,
            clientId == null ? "Default" : await ClientLabelAsync(clientId.Value),
            zones,
            speeds,
            cells,
            overridden,
            byDepot);
    }

    /// <summary>
    /// The active rate rows that belong to this group, by either route. Kept
    /// in one place because the read and the write have to agree on what
    /// "belongs to this group" means.
    /// </summary>
    private async Task<List<RateRow>> RatesForGroupAsync(
        int postcodeGroupId, int? depotId, int? clientId)
    {
        var q = Context.BulkZoneRates.AsNoTracking()
            .Where(r => r.Active)
            .Where(r => r.PostcodeGroupId == postcodeGroupId
                        || (r.PostcodeGroupId == null && depotId != null && r.DepotId == depotId));

        // Default rows are always needed: a client cell with no row of its own
        // shows the default, greyed.
        q = clientId == null
            ? q.Where(r => r.ClientId == null)
            : q.Where(r => r.ClientId == null || r.ClientId == clientId);

        return await q
            .Select(r => new RateRow(
                r.Id, r.Zone, r.SpeedId, r.ClientId, r.Amount,
                r.CourierPercentage, r.PostcodeGroupId))
            .ToListAsync();
    }

    private sealed record RateRow(
        int Id, int Zone, int? SpeedId, int? ClientId,
        decimal? Amount, decimal? CourierPercentage, int? PostcodeGroupId);

    /// <summary>
    /// Set one cell. A null Amount clears the client's override, which means
    /// deactivating the client row so the default shows through again rather
    /// than writing a zero (a real price of nothing).
    /// </summary>
    public async Task<RateCellDto> UpsertZoneRateAsync(ZoneRateUpsertRequest req)
    {
        if (req.Amount is < 0)
            throw new InvalidOperationException("A rate cannot be negative.");
        if (req.CourierPercentage is < 0 or > 100)
            throw new InvalidOperationException("Courier pay is a percentage between 0 and 100.");

        var group = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .FirstOrDefaultAsync(g => g.Id == req.PostcodeGroupId)
            ?? throw new InvalidOperationException("Postcode group not found.");

        if (req.ClientId.HasValue
            && !await Context.TucClients.AsNoTracking().AnyAsync(c => c.UcclId == req.ClientId.Value))
            throw new InvalidOperationException($"Client {req.ClientId} not found.");

        if (!await Context.TucJobTypes.AsNoTracking().AnyAsync(t => t.UcjtId == req.SpeedId))
            throw new InvalidOperationException($"Speed {req.SpeedId} not found.");

        var existing = await Context.BulkZoneRates
            .Where(r => r.Zone == req.Zone && r.SpeedId == req.SpeedId
                        && r.ClientId == req.ClientId
                        && (r.PostcodeGroupId == req.PostcodeGroupId
                            || (r.PostcodeGroupId == null && group.DepotId != null
                                && r.DepotId == group.DepotId)))
            .ToListAsync();

        var clearing = !req.Amount.HasValue;

        if (existing.Count == 0)
        {
            if (clearing)
                return new RateCellDto(req.Zone, req.SpeedId, null, null, null, true, null);

            var row = new Domain.Despatch.BulkZoneRate
            {
                Zone = req.Zone,
                SpeedId = req.SpeedId,
                ClientId = req.ClientId,
                // Both stamped: the group column is the target model and the
                // depot keeps the legacy rating function resolving.
                PostcodeGroupId = req.PostcodeGroupId,
                DepotId = group.DepotId,
                Amount = req.Amount,
                CourierPercentage = req.CourierPercentage,
                Active = true,
                Created = DateTime.UtcNow,
            };
            Context.BulkZoneRates.Add(row);
            await Context.SaveChangesAsync();
            Log.Information(
                "BulkZoneRate added: group {Group} zone {Zone} speed {Speed} client {Client}",
                req.PostcodeGroupId, req.Zone, req.SpeedId, req.ClientId);
            return new RateCellDto(
                req.Zone, req.SpeedId, row.Id, row.Amount, row.CourierPercentage, false, null);
        }

        var keep = existing[0];
        foreach (var dup in existing.Skip(1)) dup.Active = false;

        if (clearing && req.ClientId != null)
        {
            // Clearing an override: retire the client row, do not zero it.
            keep.Active = false;
            await Context.SaveChangesAsync();
            var fallback = await Context.BulkZoneRates.AsNoTracking()
                .Where(r => r.Active && r.ClientId == null && r.Zone == req.Zone
                            && r.SpeedId == req.SpeedId
                            && (r.PostcodeGroupId == req.PostcodeGroupId
                                || (r.PostcodeGroupId == null && group.DepotId != null
                                    && r.DepotId == group.DepotId)))
                .Select(r => new { r.Id, r.Amount, r.CourierPercentage })
                .FirstOrDefaultAsync();
            return new RateCellDto(
                req.Zone, req.SpeedId, fallback?.Id, fallback?.Amount,
                fallback?.CourierPercentage, true, fallback?.Amount);
        }

        keep.Amount = req.Amount;
        keep.CourierPercentage = req.CourierPercentage;
        keep.Active = !clearing;
        if (keep.PostcodeGroupId == null) keep.PostcodeGroupId = req.PostcodeGroupId;
        await Context.SaveChangesAsync();

        return new RateCellDto(
            req.Zone, req.SpeedId, clearing ? null : keep.Id,
            clearing ? null : keep.Amount, clearing ? null : keep.CourierPercentage,
            false, null);
    }

    /// <summary>Drop every override this client has in one group, which is the
    /// "Reset all to default" control.</summary>
    public async Task<int> ResetClientOverridesAsync(int postcodeGroupId, int clientId)
    {
        var group = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .FirstOrDefaultAsync(g => g.Id == postcodeGroupId)
            ?? throw new InvalidOperationException("Postcode group not found.");

        var rows = await Context.BulkZoneRates
            .Where(r => r.Active && r.ClientId == clientId
                        && (r.PostcodeGroupId == postcodeGroupId
                            || (r.PostcodeGroupId == null && group.DepotId != null
                                && r.DepotId == group.DepotId)))
            .ToListAsync();
        foreach (var r in rows) r.Active = false;
        if (rows.Count > 0) await Context.SaveChangesAsync();
        return rows.Count;
    }

    // ─── DIMENSIONS ────────────────────────────────────────────────────────

    /// <summary>
    /// Dimension bands. A client with any rows of its own uses ONLY its own:
    /// there is no merge with the default, which is how the legacy screen
    /// behaves and what UsingOwnRows reports so the tab can say it out loud.
    /// </summary>
    public async Task<PackageRatesDto> GetPackageRatesAsync(int? clientId = null)
    {
        var own = clientId == null
            ? []
            : await Context.BulkZonePackageRates.AsNoTracking()
                .Where(r => r.ClientId == clientId)
                .ToListAsync();

        var usingOwn = own.Count > 0;
        var rows = usingOwn
            ? own
            : await Context.BulkZonePackageRates.AsNoTracking()
                .Where(r => r.ClientId == null)
                .ToListAsync();

        var setIds = rows.Where(r => r.SetId != null).Select(r => r.SetId!.Value).Distinct().ToList();
        var setNames = setIds.Count == 0
            ? new Dictionary<int, string>()
            : await Context.BulkZonePackageRateSets.AsNoTracking()
                .Where(s => setIds.Contains(s.Id))
                .ToDictionaryAsync(s => s.Id, s => s.Name);

        return new PackageRatesDto(
            clientId,
            clientId == null ? "Default" : await ClientLabelAsync(clientId.Value),
            usingOwn,
            rows
                .Select(r => new PackageRateDto(
                    r.Id, r.SetId,
                    r.SetId != null && setNames.TryGetValue(r.SetId.Value, out var n) ? n : null,
                    r.ClientId, r.Name, r.FromCubic, r.ToCubic, r.FromWeight, r.ToWeight, r.CubicRate))
                .OrderBy(r => r.FromWeight ?? 0).ThenBy(r => r.FromCubic ?? 0)
                .ToList());
    }

    public async Task<PackageRateDto> UpsertPackageRateAsync(PackageRateUpsertRequest req)
    {
        if (req.CubicRate < 0)
            throw new InvalidOperationException("A cubic rate cannot be negative.");
        if (req.FromCubic.HasValue && req.ToCubic.HasValue && req.FromCubic > req.ToCubic)
            throw new InvalidOperationException("The cubic band starts above where it ends.");
        if (req.FromWeight.HasValue && req.ToWeight.HasValue && req.FromWeight > req.ToWeight)
            throw new InvalidOperationException("The weight band starts above where it ends.");

        var row = req.Id.HasValue
            ? await Context.BulkZonePackageRates.FirstOrDefaultAsync(r => r.Id == req.Id.Value)
              ?? throw new InvalidOperationException($"Dimension band {req.Id} not found.")
            : new Domain.Despatch.BulkZonePackageRate { Created = DateTime.UtcNow };

        row.ClientId = req.ClientId;
        row.SetId = req.SetId;
        row.Name = req.Name;
        row.FromCubic = req.FromCubic;
        row.ToCubic = req.ToCubic;
        row.FromWeight = req.FromWeight;
        row.ToWeight = req.ToWeight;
        row.CubicRate = req.CubicRate;

        if (!req.Id.HasValue) Context.BulkZonePackageRates.Add(row);
        await Context.SaveChangesAsync();

        return new PackageRateDto(
            row.Id, row.SetId, null, row.ClientId, row.Name,
            row.FromCubic, row.ToCubic, row.FromWeight, row.ToWeight, row.CubicRate);
    }

    public async Task DeletePackageRateAsync(int id)
    {
        var row = await Context.BulkZonePackageRates.FirstOrDefaultAsync(r => r.Id == id)
            ?? throw new InvalidOperationException($"Dimension band {id} not found.");
        Context.BulkZonePackageRates.Remove(row);
        await Context.SaveChangesAsync();
    }

    // ─── SURCHARGES ────────────────────────────────────────────────────────

    public async Task<List<SurchargeDto>> GetSurchargesAsync(int? clientId = null)
    {
        var rows = await Context.BulkZonePostcodeSurcharges.AsNoTracking()
            .Where(s => s.ClientId == clientId)
            .Select(s => new { s.Id, s.PostCode, s.ClientId, s.Surcharge })
            .ToListAsync();

        return rows
            .Select(s => new SurchargeDto(s.Id, s.PostCode.ToString("D4"), s.PostCode, s.ClientId, s.Surcharge))
            .OrderBy(s => s.Value)
            .ToList();
    }

    public async Task<SurchargeDto> UpsertSurchargeAsync(SurchargeUpsertRequest req)
    {
        // PostCode is an int, so 0110 is stored as 110. Parse the same way the
        // paste box does rather than inventing a second rule.
        var text = (req.Postcode ?? "").Trim();
        if (text.Length is 0 or > 4 || !text.All(char.IsDigit) || !int.TryParse(text, out var code) || code <= 0)
            throw new InvalidOperationException(
                $"\"{req.Postcode}\" is not a postcode. Use up to four digits.");

        if (req.Surcharge is < 0)
            throw new InvalidOperationException("A surcharge cannot be negative.");

        var row = req.Id.HasValue
            ? await Context.BulkZonePostcodeSurcharges.FirstOrDefaultAsync(s => s.Id == req.Id.Value)
              ?? throw new InvalidOperationException($"Surcharge {req.Id} not found.")
            : await Context.BulkZonePostcodeSurcharges
                  .FirstOrDefaultAsync(s => s.PostCode == code && s.ClientId == req.ClientId)
              ?? new Domain.Despatch.BulkZonePostcodeSurcharge();

        var isNew = row.Id == 0;
        row.PostCode = code;
        row.ClientId = req.ClientId;
        row.Surcharge = req.Surcharge;
        if (isNew) Context.BulkZonePostcodeSurcharges.Add(row);
        await Context.SaveChangesAsync();

        return new SurchargeDto(row.Id, code.ToString("D4"), code, row.ClientId, row.Surcharge);
    }

    public async Task DeleteSurchargeAsync(int id)
    {
        var row = await Context.BulkZonePostcodeSurcharges.FirstOrDefaultAsync(s => s.Id == id)
            ?? throw new InvalidOperationException($"Surcharge {id} not found.");
        Context.BulkZonePostcodeSurcharges.Remove(row);
        await Context.SaveChangesAsync();
    }

    // ─── SPEEDS ────────────────────────────────────────────────────────────

    /// <summary>
    /// Which speeds are offered on scheduled jobs (BulkImportSpeed). A client
    /// row and a global row are different things and both are reported: a
    /// client with its own rows is offered exactly those, so the global column
    /// is context rather than a second answer.
    /// </summary>
    public async Task<List<OfferedSpeedDto>> GetOfferedSpeedsAsync(int? clientId = null)
    {
        var speeds = await Context.TucJobTypes.AsNoTracking()
            .Where(t => t.UcjtName != null)
            .Select(t => new { t.UcjtId, t.UcjtName })
            .ToListAsync();

        var offered = await Context.BulkImportSpeeds.AsNoTracking()
            .Where(s => s.ClientId == null || s.ClientId == clientId)
            .Select(s => new { s.Id, s.SpeedId, s.ClientId })
            .ToListAsync();

        var globally = offered.Where(s => s.ClientId == null).Select(s => s.SpeedId).ToHashSet();
        var mine = offered.Where(s => s.ClientId != null)
            .ToDictionary(s => s.SpeedId, s => s.Id);

        return speeds
            .Select(t => new OfferedSpeedDto(
                t.UcjtId, t.UcjtName,
                globally.Contains(t.UcjtId),
                clientId == null ? globally.Contains(t.UcjtId) : mine.ContainsKey(t.UcjtId),
                mine.TryGetValue(t.UcjtId, out var id) ? id : null))
            .OrderBy(s => s.Name)
            .ToList();
    }

    public async Task<OfferedSpeedDto> SetSpeedOfferedAsync(int speedId, bool offered, int? clientId = null)
    {
        if (!await Context.TucJobTypes.AsNoTracking().AnyAsync(t => t.UcjtId == speedId))
            throw new InvalidOperationException($"Speed {speedId} not found.");

        var rows = await Context.BulkImportSpeeds
            .Where(s => s.SpeedId == speedId && s.ClientId == clientId)
            .ToListAsync();

        if (offered && rows.Count == 0)
        {
            Context.BulkImportSpeeds.Add(new Domain.Despatch.BulkImportSpeed
            {
                SpeedId = speedId,
                ClientId = clientId,
                Created = DateTime.UtcNow,
            });
            await Context.SaveChangesAsync();
        }
        else if (!offered && rows.Count > 0)
        {
            Context.BulkImportSpeeds.RemoveRange(rows);
            await Context.SaveChangesAsync();
        }

        return (await GetOfferedSpeedsAsync(clientId)).First(s => s.SpeedId == speedId);
    }

    // ─── HELPERS ───────────────────────────────────────────────────────────

    private async Task<string> ClientLabelAsync(int clientId)
    {
        var c = await Context.TucClients.AsNoTracking()
            .Where(x => x.UcclId == clientId)
            .Select(x => new { x.UcclCode, x.UcclName })
            .FirstOrDefaultAsync();
        if (c == null) throw new InvalidOperationException($"Client {clientId} not found.");
        return string.IsNullOrWhiteSpace(c.UcclCode) ? c.UcclName : c.UcclCode;
    }
}
