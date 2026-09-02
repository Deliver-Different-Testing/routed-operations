using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Territory;
using RoutedOperations.Core.Domain;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Territory;

/// <summary>
/// Read-side service for the Territory surface (Zones + Zone Groups +
/// Postcode Groups + Depots). Tenant-aware via the CountryCode claim,
/// matching ZoneLookupService: literal "US" triggers the US path,
/// anything else (incl. missing claim) falls back to NZ. Writes land in
/// Phase 3.
/// </summary>
public class TerritoryService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IHttpContextAccessor httpContextAccessor)
    : BaseService(contextFactory)
{
    public async Task<TerritoryBootstrapDto> GetBootstrapAsync()
    {
        var isUs = IsUsTenant();
        Log.Information("TerritoryService.GetBootstrap: isUs={IsUs}", isUs);

        var depots = await GetDepotsAsync();
        var postcodeGroups = await GetPostcodeGroupsAsync();

        var nzPostcodes = isUs ? new List<NzPostcodeDto>() : await GetNzPostcodesAsync();
        var usZipZones = isUs ? await GetUsZipZonesAsync() : new List<UsZipZoneDto>();
        var zoneNames = isUs ? await GetZoneNamesAsync() : new List<ZoneNameDto>();
        var zoneGroups = isUs ? await GetZoneGroupsAsync() : new List<ZoneGroupDto>();

        return new TerritoryBootstrapDto(
            isUs ? "US" : "NZ",
            depots,
            postcodeGroups,
            nzPostcodes,
            usZipZones,
            zoneNames,
            zoneGroups);
    }

    /// <summary>
    /// List depots. When clientId is provided, filter to depots that
    /// host at least one postcode group owned by that client (matches
    /// the legacy /API/Zones/Depots/Clients/{id} behaviour). Otherwise
    /// return every depot.
    /// </summary>
    public async Task<List<DepotDto>> GetDepotsAsync(int? clientId = null)
    {
        var query = Context.TblBulkRegions.AsNoTracking().AsQueryable();
        if (clientId.HasValue)
        {
            // Depots reachable via any postcode group bound to this
            // client. Union with depots the client's ZoneName rows live
            // in so US tenants also get the right set.
            var depotIdsFromGroups = Context.BulkZonePostcodeGroups
                .Where(g => g.ClientId == clientId.Value && g.DepotId != null)
                .Select(g => g.DepotId!.Value);
            var depotIdsFromZones = Context.ZoneNames
                .Where(zn => zn.ZoneZips.Any(z => z.ClientId == clientId.Value) && zn.LocationId != null)
                .Select(zn => zn.LocationId!.Value);
            var union = depotIdsFromGroups.Union(depotIdsFromZones).Distinct();
            query = query.Where(r => union.Contains(r.BulkRegionId));
        }
        return await query
            .OrderBy(r => r.Name)
            .Select(r => new DepotDto(r.BulkRegionId, r.Name, r.Active ?? true))
            .ToListAsync();
    }

    /// <summary>
    /// List postcode groups. When clientId is provided, filter to groups
    /// owned by that client OR by no client (client-agnostic defaults).
    /// Matches the legacy /API/BulkZonePostcodeGroups/Clients/{id}
    /// behaviour.
    /// </summary>
    public async Task<List<PostcodeGroupDto>> GetPostcodeGroupsAsync(int? clientId = null)
    {
        // Client-code dictionary for the ClientCode field.
        var clientCodes = await Context.TucClients.AsNoTracking()
            .Where(c => c.UcclCode != null)
            .Take(50000)
            .ToDictionaryAsync(c => c.UcclId, c => c.UcclCode);

        var query = Context.BulkZonePostcodeGroups.AsNoTracking()
            .Include(g => g.Depot)
            .Include(g => g.BulkZonePostcodes)
            .AsQueryable();
        if (clientId.HasValue)
            query = query.Where(g => g.ClientId == clientId.Value || g.ClientId == null);
        var rows = await query.OrderBy(g => g.Name).ToListAsync();
        return rows.Select(g => new PostcodeGroupDto(
            g.Id,
            g.Name,
            g.DepotId,
            g.Depot?.Name,
            g.ClientId,
            g.ClientId.HasValue && clientCodes.TryGetValue(g.ClientId.Value, out var code) ? code : null,
            g.BulkZonePostcodes.Count)).ToList();
    }

    /// <summary>Resolve client code -> id server-side (operator-facing
    /// callers pass code because ids are meaningless in the UI).</summary>
    public async Task<int?> ResolveClientCodeAsync(string clientCode)
    {
        if (string.IsNullOrWhiteSpace(clientCode)) return null;
        var trimmed = clientCode.Trim();
        var id = await Context.TucClients.AsNoTracking()
            .Where(c => c.UcclCode == trimmed)
            .Select(c => (int?)c.UcclId)
            .FirstOrDefaultAsync();
        if (id == null)
            throw new InvalidOperationException($"Client code '{trimmed}' not found.");
        return id;
    }

    public async Task<List<NzPostcodeDto>> GetNzPostcodesAsync() =>
        await Context.BulkZonePostcodes.AsNoTracking()
            .Include(p => p.Depot)
            .Include(p => p.PostcodeGroup)
            .OrderBy(p => p.Depot != null ? p.Depot.Name : null)
            .ThenBy(p => p.PostCode)
            .Select(p => new NzPostcodeDto(
                p.Id,
                p.PostCode,
                p.Zone,
                p.DepotId,
                p.Depot != null ? p.Depot.Name : null,
                p.PostcodeGroupId,
                p.PostcodeGroup != null ? p.PostcodeGroup.Name : null,
                p.FromSiteId,
                p.Name,
                p.FromLatLng))
            .ToListAsync();

    public async Task<List<UsZipZoneDto>> GetUsZipZonesAsync()
    {
        // ZoneZip.ZoneZipGroupId points at BulkZonePostcodeGroup but the entity
        // does not expose a ZoneZipGroup navigation, so we resolve the group
        // name via a one-shot dictionary lookup.
        var groupNames = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .ToDictionaryAsync(g => g.Id, g => g.Name);

        var rows = await Context.ZoneZips.AsNoTracking()
            .Include(z => z.ZoneName)
                .ThenInclude(zn => zn.ZoneGroup)
            .OrderBy(z => z.ZoneName != null ? z.ZoneName.ZoneName1 : null)
            .ThenBy(z => z.Zip)
            .ToListAsync();

        return rows.Select(z => new UsZipZoneDto(
            z.ZoneZipId,
            z.Zip,
            z.ZoneNumber,
            z.ZoneNameId,
            z.ZoneName?.ZoneName1,
            z.ZoneName?.ZoneGroupId,
            z.ZoneName?.ZoneGroup?.Name,
            z.ZoneZipGroupId,
            z.ZoneZipGroupId.HasValue && groupNames.TryGetValue(z.ZoneZipGroupId.Value, out var n) ? n : null,
            z.ApplyCongestion)).ToList();
    }

    public async Task<List<ZoneNameDto>> GetZoneNamesAsync() =>
        await Context.ZoneNames.AsNoTracking()
            .Include(zn => zn.ZoneGroup)
            .Include(zn => zn.Location)
            .Include(zn => zn.ZoneZips)
            .OrderBy(zn => zn.ZoneName1)
            .Select(zn => new ZoneNameDto(
                zn.ZoneNameId,
                zn.ZoneName1,
                zn.ZoneGroupId,
                zn.ZoneGroup != null ? zn.ZoneGroup.Name : null,
                zn.LocationId,
                zn.Location != null ? zn.Location.Name : null,
                zn.ZoneZips.Count))
            .ToListAsync();

    public async Task<List<ZoneGroupDto>> GetZoneGroupsAsync() =>
        await Context.ZoneGroups.AsNoTracking()
            .Include(g => g.ZoneNames)
            .OrderBy(g => g.Name)
            .Select(g => new ZoneGroupDto(
                g.ZoneGroupId,
                g.Name,
                g.ClearListAreaId,
                g.ZoneNames.Count))
            .ToListAsync();

    private bool IsUsTenant()
    {
        var countryCode = httpContextAccessor.HttpContext?.User
            .FindFirstValue("CountryCode");
        return string.Equals(countryCode, "US", StringComparison.OrdinalIgnoreCase);
    }

    // ─── POSTCODE GROUP WRITES ─────────────────────────────────────────────

    public async Task<PostcodeGroupDto> CreatePostcodeGroupAsync(PostcodeGroupUpsertRequest req)
    {
        RequireName(req.Name);
        var entity = new Domain.Despatch.BulkZonePostcodeGroup
        {
            Name = req.Name.Trim(),
            DepotId = req.DepotId,
            ClientId = await ResolveClientAsync(req.ClientCode, req.ClientId),
        };
        Context.BulkZonePostcodeGroups.Add(entity);
        await Context.SaveChangesAsync();
        return await GetPostcodeGroupAsync(entity.Id);
    }

    public async Task<PostcodeGroupDto> UpdatePostcodeGroupAsync(int id, PostcodeGroupUpsertRequest req)
    {
        RequireName(req.Name);
        var entity = await Context.BulkZonePostcodeGroups
            .FirstOrDefaultAsync(g => g.Id == id)
            ?? throw new InvalidOperationException("Postcode group not found.");
        entity.Name = req.Name.Trim();
        entity.DepotId = req.DepotId;
        entity.ClientId = await ResolveClientAsync(req.ClientCode, req.ClientId);
        await Context.SaveChangesAsync();
        return await GetPostcodeGroupAsync(id);
    }

    /// <summary>
    /// Preferred path: caller provides ClientCode. Falls back to
    /// ClientId when code is empty. Empty on both -> null (client-agnostic
    /// group). Unknown code -> throws with a clear message.
    /// </summary>
    private async Task<int?> ResolveClientAsync(string clientCode, int? clientId)
    {
        if (!string.IsNullOrWhiteSpace(clientCode))
            return await ResolveClientCodeAsync(clientCode);
        return clientId;
    }

    public async Task DeletePostcodeGroupAsync(int id)
    {
        var entity = await Context.BulkZonePostcodeGroups
            .FirstOrDefaultAsync(g => g.Id == id)
            ?? throw new InvalidOperationException("Postcode group not found.");
        Context.BulkZonePostcodeGroups.Remove(entity);
        await Context.SaveChangesAsync();
    }

    private async Task<PostcodeGroupDto> GetPostcodeGroupAsync(int id)
    {
        var g = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .Include(x => x.Depot)
            .Include(x => x.BulkZonePostcodes)
            .FirstAsync(x => x.Id == id);
        // Post-write hydration - resolve the single client's code if present.
        string clientCode = null;
        if (g.ClientId.HasValue)
        {
            clientCode = await Context.TucClients.AsNoTracking()
                .Where(c => c.UcclId == g.ClientId.Value)
                .Select(c => c.UcclCode)
                .FirstOrDefaultAsync();
        }
        return new PostcodeGroupDto(g.Id, g.Name, g.DepotId, g.Depot?.Name, g.ClientId, clientCode, g.BulkZonePostcodes.Count);
    }

    // ─── NZ POSTCODE WRITES ────────────────────────────────────────────────

    public async Task<NzPostcodeDto> CreateNzPostcodeAsync(NzPostcodeUpsertRequest req)
    {
        var entity = new Domain.Despatch.BulkZonePostcode
        {
            PostCode = req.PostCode,
            Zone = req.Zone,
            DepotId = req.DepotId,
            PostcodeGroupId = req.PostcodeGroupId,
            FromSiteId = req.FromSiteId,
            Name = req.Name,
            FromLatLng = req.FromLatLng,
            Created = DateTime.UtcNow,
        };
        Context.BulkZonePostcodes.Add(entity);
        await Context.SaveChangesAsync();
        return await GetNzPostcodeAsync(entity.Id);
    }

    public async Task<NzPostcodeDto> UpdateNzPostcodeAsync(int id, NzPostcodeUpsertRequest req)
    {
        var entity = await Context.BulkZonePostcodes
            .FirstOrDefaultAsync(p => p.Id == id)
            ?? throw new InvalidOperationException("Postcode not found.");
        entity.PostCode = req.PostCode;
        entity.Zone = req.Zone;
        entity.DepotId = req.DepotId;
        entity.PostcodeGroupId = req.PostcodeGroupId;
        entity.FromSiteId = req.FromSiteId;
        entity.Name = req.Name;
        entity.FromLatLng = req.FromLatLng;
        await Context.SaveChangesAsync();
        return await GetNzPostcodeAsync(id);
    }

    public async Task DeleteNzPostcodeAsync(int id)
    {
        var entity = await Context.BulkZonePostcodes
            .FirstOrDefaultAsync(p => p.Id == id)
            ?? throw new InvalidOperationException("Postcode not found.");
        Context.BulkZonePostcodes.Remove(entity);
        await Context.SaveChangesAsync();
    }

    private async Task<NzPostcodeDto> GetNzPostcodeAsync(int id)
    {
        var p = await Context.BulkZonePostcodes.AsNoTracking()
            .Include(x => x.Depot)
            .Include(x => x.PostcodeGroup)
            .FirstAsync(x => x.Id == id);
        return new NzPostcodeDto(
            p.Id, p.PostCode, p.Zone, p.DepotId, p.Depot?.Name,
            p.PostcodeGroupId, p.PostcodeGroup?.Name, p.FromSiteId, p.Name, p.FromLatLng);
    }

    // ─── US ZIP ZONE WRITES ────────────────────────────────────────────────

    public async Task<UsZipZoneDto> CreateUsZipZoneAsync(UsZipZoneUpsertRequest req)
    {
        var entity = new Domain.Despatch.ZoneZip
        {
            Zip = req.Zip,
            ZoneNumber = req.ZoneNumber,
            ZoneNameId = req.ZoneNameId,
            ZoneZipGroupId = req.ZoneZipGroupId,
            ApplyCongestion = req.ApplyCongestion,
            ClientId = req.ClientId,
            Created = DateTime.UtcNow,
        };
        Context.ZoneZips.Add(entity);
        await Context.SaveChangesAsync();
        return await GetUsZipZoneAsync(entity.ZoneZipId);
    }

    public async Task<UsZipZoneDto> UpdateUsZipZoneAsync(int id, UsZipZoneUpsertRequest req)
    {
        var entity = await Context.ZoneZips
            .FirstOrDefaultAsync(z => z.ZoneZipId == id)
            ?? throw new InvalidOperationException("Zip zone not found.");
        entity.Zip = req.Zip;
        entity.ZoneNumber = req.ZoneNumber;
        entity.ZoneNameId = req.ZoneNameId;
        entity.ZoneZipGroupId = req.ZoneZipGroupId;
        entity.ApplyCongestion = req.ApplyCongestion;
        entity.ClientId = req.ClientId;
        entity.LastModified = DateTime.UtcNow;
        await Context.SaveChangesAsync();
        return await GetUsZipZoneAsync(id);
    }

    public async Task DeleteUsZipZoneAsync(int id)
    {
        var entity = await Context.ZoneZips
            .FirstOrDefaultAsync(z => z.ZoneZipId == id)
            ?? throw new InvalidOperationException("Zip zone not found.");
        Context.ZoneZips.Remove(entity);
        await Context.SaveChangesAsync();
    }

    private async Task<UsZipZoneDto> GetUsZipZoneAsync(int id)
    {
        var groupNames = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .ToDictionaryAsync(g => g.Id, g => g.Name);
        var z = await Context.ZoneZips.AsNoTracking()
            .Include(x => x.ZoneName)
                .ThenInclude(zn => zn.ZoneGroup)
            .FirstAsync(x => x.ZoneZipId == id);
        return new UsZipZoneDto(
            z.ZoneZipId, z.Zip, z.ZoneNumber, z.ZoneNameId, z.ZoneName?.ZoneName1,
            z.ZoneName?.ZoneGroupId, z.ZoneName?.ZoneGroup?.Name,
            z.ZoneZipGroupId,
            z.ZoneZipGroupId.HasValue && groupNames.TryGetValue(z.ZoneZipGroupId.Value, out var n) ? n : null,
            z.ApplyCongestion);
    }

    // ─── ZONE NAME WRITES (US) ─────────────────────────────────────────────

    public async Task<ZoneNameDto> CreateZoneNameAsync(ZoneNameUpsertRequest req)
    {
        RequireName(req.Name);
        var entity = new Domain.Despatch.ZoneName
        {
            ZoneName1 = req.Name.Trim(),
            ZoneGroupId = req.ZoneGroupId,
            LocationId = req.LocationId,
            Created = DateTime.UtcNow,
        };
        Context.ZoneNames.Add(entity);
        await Context.SaveChangesAsync();
        return await GetZoneNameAsync(entity.ZoneNameId);
    }

    public async Task<ZoneNameDto> UpdateZoneNameAsync(int id, ZoneNameUpsertRequest req)
    {
        RequireName(req.Name);
        var entity = await Context.ZoneNames
            .FirstOrDefaultAsync(z => z.ZoneNameId == id)
            ?? throw new InvalidOperationException("Zone name not found.");
        entity.ZoneName1 = req.Name.Trim();
        entity.ZoneGroupId = req.ZoneGroupId;
        entity.LocationId = req.LocationId;
        entity.LastModified = DateTime.UtcNow;
        await Context.SaveChangesAsync();
        return await GetZoneNameAsync(id);
    }

    public async Task DeleteZoneNameAsync(int id)
    {
        var entity = await Context.ZoneNames
            .FirstOrDefaultAsync(z => z.ZoneNameId == id)
            ?? throw new InvalidOperationException("Zone name not found.");
        Context.ZoneNames.Remove(entity);
        await Context.SaveChangesAsync();
    }

    private async Task<ZoneNameDto> GetZoneNameAsync(int id)
    {
        var zn = await Context.ZoneNames.AsNoTracking()
            .Include(x => x.ZoneGroup)
            .Include(x => x.Location)
            .Include(x => x.ZoneZips)
            .FirstAsync(x => x.ZoneNameId == id);
        return new ZoneNameDto(zn.ZoneNameId, zn.ZoneName1, zn.ZoneGroupId, zn.ZoneGroup?.Name,
            zn.LocationId, zn.Location?.Name, zn.ZoneZips.Count);
    }

    // ─── ZONE GROUP WRITES (US) ────────────────────────────────────────────

    public async Task<ZoneGroupDto> CreateZoneGroupAsync(ZoneGroupUpsertRequest req)
    {
        RequireName(req.Name);
        var entity = new Domain.Despatch.ZoneGroup
        {
            Name = req.Name.Trim(),
            ClearListAreaId = req.ClearListAreaId,
            Created = DateTime.UtcNow,
        };
        Context.ZoneGroups.Add(entity);
        await Context.SaveChangesAsync();
        return await GetZoneGroupAsync(entity.ZoneGroupId);
    }

    public async Task<ZoneGroupDto> UpdateZoneGroupAsync(int id, ZoneGroupUpsertRequest req)
    {
        RequireName(req.Name);
        var entity = await Context.ZoneGroups
            .FirstOrDefaultAsync(g => g.ZoneGroupId == id)
            ?? throw new InvalidOperationException("Zone group not found.");
        entity.Name = req.Name.Trim();
        entity.ClearListAreaId = req.ClearListAreaId;
        entity.LastModified = DateTime.UtcNow;
        await Context.SaveChangesAsync();
        return await GetZoneGroupAsync(id);
    }

    public async Task DeleteZoneGroupAsync(int id)
    {
        var entity = await Context.ZoneGroups
            .FirstOrDefaultAsync(g => g.ZoneGroupId == id)
            ?? throw new InvalidOperationException("Zone group not found.");
        Context.ZoneGroups.Remove(entity);
        await Context.SaveChangesAsync();
    }

    private async Task<ZoneGroupDto> GetZoneGroupAsync(int id)
    {
        var g = await Context.ZoneGroups.AsNoTracking()
            .Include(x => x.ZoneNames)
            .FirstAsync(x => x.ZoneGroupId == id);
        return new ZoneGroupDto(g.ZoneGroupId, g.Name, g.ClearListAreaId, g.ZoneNames.Count);
    }

    private static void RequireName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Name is required.");
    }

    /// <summary>Resolve the postcodes the Schedule editor map should
    /// render. Two buckets:
    ///   * Bound = ZipPolygon rows whose Zip matches one of the passed
    ///     BoundPostcodes ints (the schedule's individual-postcode
    ///     junction).
    ///   * ZoneDerived = ZipPolygon rows for postcodes matched via
    ///     BulkZonePostcode on (DepotId + Zone IN zones). Excludes any
    ///     postcode already in the bound set to keep the wire tidy.
    /// Empty input on either side just returns empty for that bucket -
    /// caller can skip the second fetch.</summary>
    public async Task<PostcodesForScheduleResponse> GetPostcodesForScheduleAsync(PostcodesForScheduleRequest req)
    {
        var bound = new List<int>();
        var zoneDerived = new List<int>();

        // Postcode ints -> string comparison for the ZipPolygon.Zip
        // join. NZ postcodes are 4-digit; US zips are 5-digit; both
        // survive int.ToString() as-is because we never carry leading
        // zeros through the int type. If a tenant has zero-padded NZ
        // postcodes (e.g. "0510") stored as int 510, this WOULD miss
        // them - flag as a follow-up if it bites.
        if (req.BoundPostcodes?.Count > 0)
        {
            var boundStrs = req.BoundPostcodes.Select(p => p.ToString()).Distinct().ToList();
            bound = await Context.ZipPolygons.AsNoTracking()
                .Where(z => z.Zip != null && boundStrs.Contains(z.Zip))
                .Select(z => z.ZipPolygonId)
                .ToListAsync();
        }

        if (req.DepotId.HasValue && req.Zones?.Count > 0)
        {
            var depot = req.DepotId.Value;
            var zoneList = req.Zones.Distinct().ToList();
            // Two-step: (1) postcode ints for (depot, zones); (2)
            // ZipPolygon ids by string join. Kept as two round-trips so
            // the second is EF-translatable (Contains over a small
            // in-memory list).
            var derivedInts = await Context.BulkZonePostcodes.AsNoTracking()
                .Where(p => p.DepotId == depot && zoneList.Contains(p.Zone))
                .Select(p => p.PostCode)
                .Distinct()
                .ToListAsync();
            // Exclude postcodes already in the bound set - avoid double
            // colour on the map.
            var derivedStrs = derivedInts
                .Where(p => !req.BoundPostcodes.Contains(p))
                .Select(p => p.ToString())
                .Distinct()
                .ToList();
            if (derivedStrs.Count > 0)
            {
                zoneDerived = await Context.ZipPolygons.AsNoTracking()
                    .Where(z => z.Zip != null && derivedStrs.Contains(z.Zip))
                    .Select(z => z.ZipPolygonId)
                    .ToListAsync();
            }
        }

        return new PostcodesForScheduleResponse(bound, zoneDerived);
    }

    // ─── DEPOT ACTIVATE / DEACTIVATE ────────────────────────────────────
    // Full depot CRUD (address, GPS, audit) stays in AdminManager - that's
    // the shared surface across ClientManager + AdminManager + DespatchWeb.
    // The Schedules module only exposes the on/off toggle operators use to
    // hide a retired depot from the schedule / linehaul / postcode-group
    // dropdowns without switching apps.
    public async Task<DepotDto> SetDepotActiveAsync(int id, bool active)
    {
        var entity = await Context.TblBulkRegions.FirstOrDefaultAsync(x => x.BulkRegionId == id)
            ?? throw new InvalidOperationException("Depot not found.");
        entity.Active = active;
        await Context.SaveChangesAsync();
        Log.Information("Depot {Id} Active={Active}", id, active);
        return new DepotDto(entity.BulkRegionId, entity.Name, entity.Active ?? true);
    }
}
