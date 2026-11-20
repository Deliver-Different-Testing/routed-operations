using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
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
        var hasZoneGroups = HasZoneGroups();
        Log.Information("TerritoryService.GetBootstrap: isUs={IsUs} hasZoneGroups={HasZoneGroups}", isUs, hasZoneGroups);

        var depots = await GetDepotsAsync();
        var postcodeGroups = await GetPostcodeGroupsAsync();

        var nzPostcodes = isUs ? new List<NzPostcodeDto>() : await GetNzPostcodesAsync();
        var usZipZones = isUs ? await GetUsZipZonesAsync() : new List<UsZipZoneDto>();
        // Zone groups and the zone names under them are US and AU (Kevin, 12
        // Nov): an AU tenant points its zone groups at driver location lists
        // exactly the way US does (Crisis staging: 15 groups, every one with a
        // ClearListAreaId). NZ stays without them.
        var zoneNames = hasZoneGroups ? await GetZoneNamesAsync() : new List<ZoneNameDto>();
        var zoneGroups = hasZoneGroups ? await GetZoneGroupsAsync() : new List<ZoneGroupDto>();

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
    /// Every depot in the tenant with whether it is switched off for this
    /// client. Deliberately NOT the filtered list GetDepotsAsync returns: the
    /// editor has to show depots the client cannot currently reach, because
    /// turning one back on is the whole point of it.
    /// </summary>
    public async Task<List<DepotClientLimitDto>> GetDepotClientLimitsAsync(int clientId)
    {
        await RequireClientAsync(clientId);

        var off = await Context.TblBulkRegionClientLimits.AsNoTracking()
            .Where(l => l.ClientId == clientId && l.BulkRegionId != null)
            .Select(l => l.BulkRegionId!.Value)
            .ToListAsync();
        var offSet = off.ToHashSet();

        return (await Context.TblBulkRegions.AsNoTracking()
                .OrderBy(r => r.Name)
                .Select(r => new { r.BulkRegionId, r.Name, r.Active })
                .ToListAsync())
            .Select(r => new DepotClientLimitDto(
                r.BulkRegionId, r.Name, r.Active ?? true, offSet.Contains(r.BulkRegionId)))
            .ToList();
    }

    /// <summary>
    /// Switch a depot off for one client, or back on. Mirrors ClientManager:
    /// off INSERTS a row, on DELETES it, so absence is the normal state and
    /// nothing needs seeding. Idempotent in both directions.
    /// </summary>
    public async Task<DepotClientLimitDto> SetDepotClientLimitAsync(
        int depotId, int clientId, bool off)
    {
        var depot = await Context.TblBulkRegions.AsNoTracking()
            .FirstOrDefaultAsync(r => r.BulkRegionId == depotId)
            ?? throw new InvalidOperationException(
                $"{(IsUsTenant() ? "Location" : "Depot")} {depotId} not found.");
        await RequireClientAsync(clientId);

        // Every row for the pair, not one: nothing stops a duplicate being
        // written by another surface, and leaving a second row behind would
        // read as "off" forever once this one is deleted.
        var rows = await Context.TblBulkRegionClientLimits
            .Where(l => l.ClientId == clientId && l.BulkRegionId == depotId)
            .ToListAsync();

        if (off && rows.Count == 0)
        {
            Context.TblBulkRegionClientLimits.Add(new Domain.Despatch.TblBulkRegionClientLimit
            {
                BulkRegionId = depotId,
                ClientId = clientId,
                Deactivated = true,
            });
            await Context.SaveChangesAsync();
        }
        else if (!off && rows.Count > 0)
        {
            Context.TblBulkRegionClientLimits.RemoveRange(rows);
            await Context.SaveChangesAsync();
        }

        return new DepotClientLimitDto(depot.BulkRegionId, depot.Name, depot.Active ?? true, off);
    }

    /// <summary>
    /// The map panel beside a zone group (spec 11.8): every member postcode's
    /// boundary, carrying the zone it sits in so the map can shade by zone,
    /// plus the depot's coordinates for the pin.
    ///
    /// NZ postcode boundaries live in the same dbo.ZipPolygon table as US
    /// zips, which is why one query serves both tenants (Steve, 21 Oct).
    /// BulkZonePostcode.PostCode is an int so 0600 is stored as 600, while
    /// ZipPolygon.Zip is the padded four-character text, so the join is on
    /// the padded spelling. Codes with no row there are returned separately
    /// rather than dropped: a map quietly missing two of ten zones reads as
    /// broken, while a map that names them reads as incomplete data.
    /// </summary>
    public async Task<ZoneMapDto> GetZoneMapAsync(int postcodeGroupId)
    {
        var group = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .FirstOrDefaultAsync(g => g.Id == postcodeGroupId)
            ?? throw new InvalidOperationException("Postcode group not found.");

        var depot = group.DepotId == null
            ? null
            : await Context.TblBulkRegions.AsNoTracking()
                .Where(d => d.BulkRegionId == group.DepotId)
                .Select(d => new { d.Name, d.PickupLatitude, d.PickupLongitude })
                .FirstOrDefaultAsync();

        // Zone per code. US groups hold their members in ZoneZip, where the
        // zip is already text.
        List<(int Zone, string Code)> members;
        if (IsUsTenant())
        {
            members = (await Context.ZoneZips.AsNoTracking()
                    .Where(z => z.ZoneZipGroupId == postcodeGroupId && z.Zip != null)
                    .Select(z => new { z.ZoneNumber, z.Zip })
                    .ToListAsync())
                .Select(z => (z.ZoneNumber ?? 0, z.Zip.Trim()))
                .ToList();
        }
        else
        {
            members = (await Context.BulkZonePostcodes.AsNoTracking()
                    .Where(p => p.PostcodeGroupId == postcodeGroupId)
                    .Select(p => new { p.Zone, p.PostCode })
                    .ToListAsync())
                .Select(p => (p.Zone, p.PostCode.ToString("D4")))
                .ToList();
        }

        var zoneByCode = members
            .GroupBy(m => m.Code)
            .ToDictionary(g => g.Key, g => g.First().Zone);
        var codes = zoneByCode.Keys.ToList();
        if (codes.Count == 0)
            return new ZoneMapDto(
                postcodeGroupId, group.Name, group.DepotId, depot?.Name,
                depot?.PickupLatitude, depot?.PickupLongitude, [], []);

        var found = await Context.ZipPolygons.AsNoTracking()
            .Where(z => z.Zip != null && codes.Contains(z.Zip))
            .Select(z => new { z.ZipPolygonId, z.Zip, z.Latitude, z.Longitude, z.Wkt })
            .ToListAsync();

        var shapes = found
            .Where(z => zoneByCode.ContainsKey(z.Zip))
            .Select(z => new ZoneMapShapeDto(
                zoneByCode[z.Zip], z.Zip, z.ZipPolygonId, z.Latitude, z.Longitude, z.Wkt))
            .OrderBy(z => z.Zone).ThenBy(z => z.Code)
            .ToList();

        var withShape = found.Select(z => z.Zip).ToHashSet();
        var missing = codes.Where(c => !withShape.Contains(c)).OrderBy(c => c).ToList();

        return new ZoneMapDto(
            postcodeGroupId, group.Name, group.DepotId, depot?.Name,
            depot?.PickupLatitude, depot?.PickupLongitude, shapes, missing);
    }

    /// <summary>Reject an unknown client id loudly rather than silently
    /// writing a limit row nothing will ever read.</summary>
    private async Task RequireClientAsync(int clientId)
    {
        if (!await Context.TucClients.AsNoTracking().AnyAsync(c => c.UcclId == clientId))
            throw new InvalidOperationException($"Client {clientId} not found.");
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
            .AsQueryable();
        if (clientId.HasValue)
            query = query.Where(g => g.ClientId == clientId.Value || g.ClientId == null);
        var rows = await query.OrderBy(g => g.Name).ToListAsync();

        var counts = await LoadGroupCountsAsync(rows.Select(g => g.Id).ToList());
        return rows.Select(g => ToDto(
            g,
            g.ClientId.HasValue && clientCodes.TryGetValue(g.ClientId.Value, out var code) ? code : null,
            counts)).ToList();
    }

    /// <summary>Group detail: the group plus every reference to it. Nothing
    /// on the group row itself gives it force (no stored procedure reads
    /// its ClientId or DepotId), so the references ARE the detail.</summary>
    public async Task<PostcodeGroupDetailDto> GetPostcodeGroupDetailAsync(int id)
    {
        var g = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .Include(x => x.Depot)
            .FirstOrDefaultAsync(x => x.Id == id)
            ?? throw new InvalidOperationException("Postcode group not found.");

        string clientCode = null;
        if (g.ClientId.HasValue)
            clientCode = await Context.TucClients.AsNoTracking()
                .Where(c => c.UcclId == g.ClientId.Value)
                .Select(c => c.UcclCode)
                .FirstOrDefaultAsync();

        var ids = new List<int> { id };
        var counts = await LoadGroupCountsAsync(ids);

        // Zones, with the label from wherever this tenant keeps it.
        var isUs = IsUsTenant();
        List<PostcodeGroupZoneDto> zones;
        if (isUs)
        {
            var zips = await Context.ZoneZips.AsNoTracking()
                .Include(z => z.ZoneName)
                .Where(z => z.ZoneZipGroupId == id)
                .Select(z => new
                {
                    z.ZoneZipId,
                    z.Zip,
                    Zone = z.ZoneNumber ?? 0,
                    Label = z.ZoneName != null ? z.ZoneName.ZoneName1 : null,
                })
                .ToListAsync();
            zones = zips.GroupBy(z => z.Zone)
                .Select(grp => new PostcodeGroupZoneDto(
                    grp.Key,
                    grp.Select(x => x.Label).FirstOrDefault(l => !string.IsNullOrWhiteSpace(l)),
                    grp.Count(),
                    grp.OrderBy(x => x.Zip)
                       .Select(x => new PostcodeGroupMemberDto(
                           x.ZoneZipId,
                           x.Zip,
                           int.TryParse(x.Zip, out var zv) ? zv : 0,
                           x.Label))
                       .ToList()))
                .OrderBy(z => z.Zone).ToList();
        }
        else
        {
            var pcs = await Context.BulkZonePostcodes.AsNoTracking()
                .Where(p => p.PostcodeGroupId == id)
                .Select(p => new { p.Id, p.PostCode, p.Zone, p.Name })
                .ToListAsync();
            zones = pcs.GroupBy(p => p.Zone)
                .Select(grp => new PostcodeGroupZoneDto(
                    grp.Key,
                    grp.Select(x => x.Name).FirstOrDefault(n => !string.IsNullOrWhiteSpace(n)),
                    grp.Count(),
                    grp.OrderBy(x => x.PostCode)
                       // D4 restores the leading zero the int column drops:
                       // 110 is Whangarei's 0110, and 673 of Urgent's 3,025
                       // rows are that shape.
                       .Select(x => new PostcodeGroupMemberDto(
                           x.Id, x.PostCode.ToString("D4"), x.PostCode, x.Name))
                       .ToList()))
                .OrderBy(z => z.Zone).ToList();
        }

        // Schedules on either side. Counted by distinct header, because an
        // operator thinks in schedules and a schedule carries up to seven
        // day rows; the day count is kept as the secondary figure.
        // Through the view, never the day table: a converted schedule's group
        // ids live on its detail row and its day rows hold NULL, and the view
        // also drops the days its weekday mask has switched off.
        var dayRows = await Context.TblBulkRunSchedules.AsNoTracking()
            .Where(d => d.PostcodeGroupId == id || d.PickupPostcodeGroupId == id)
            .Select(d => new { d.ScheduleId, d.Name, d.PostcodeGroupId, d.PickupPostcodeGroupId })
            .ToListAsync();
        var headerNames = await Context.BulkRunScheduleHeaders.AsNoTracking()
            .Where(h => dayRows.Select(d => d.ScheduleId).Contains(h.ScheduleId))
            .Select(h => new { h.ScheduleId, h.Name })
            .ToDictionaryAsync(h => h.ScheduleId, h => h.Name);
        var schedules = dayRows.GroupBy(d => d.ScheduleId)
            .Select(grp => new PostcodeGroupScheduleDto(
                grp.Key,
                headerNames.TryGetValue(grp.Key, out var hn) && !string.IsNullOrWhiteSpace(hn)
                    ? hn
                    : grp.Select(x => x.Name).FirstOrDefault(n => !string.IsNullOrWhiteSpace(n)) ?? $"#{grp.Key}",
                grp.Any(x => x.PostcodeGroupId == id),
                grp.Any(x => x.PickupPostcodeGroupId == id),
                grp.Count()))
            .OrderBy(s => s.Name)
            .ToList();

        // Membership, not ownership. A shape is a member of a zone inside this
        // group exactly the way a postcode is (BulkZonePolygon, unique on
        // (PostcodeGroupId, PolygonId), migration 20261007170000), so the same
        // shape can also be a different zone of another group.
        var polygons = await (
                from zp in Context.BulkZonePolygons.AsNoTracking()
                join p in Context.BulkRunPolygons.AsNoTracking()
                    on zp.PolygonId equals p.PolygonId
                where zp.Active && p.Active && zp.PostcodeGroupId == id
                orderby zp.Zone, p.Name
                select new BoundPolygonDto(
                    p.PolygonId, p.Name, p.ZoneNameId, zp.PostcodeGroupId,
                    p.CentroidLatitude, p.CentroidLongitude, zp.Zone, zp.Id))
            .ToListAsync();

        return new PostcodeGroupDetailDto(ToDto(g, clientCode, counts), zones, schedules, polygons);
    }

    /// <summary>Per-group member / zone / polygon / schedule counts.</summary>
    private sealed record GroupCounts(
        int Members, int Zones, int Polygons, int DeliverySchedules, int PickupSchedules);

    private static readonly GroupCounts EmptyCounts = new(0, 0, 0, 0, 0);

    private PostcodeGroupDto ToDto(
        Domain.Despatch.BulkZonePostcodeGroup g,
        string clientCode,
        IReadOnlyDictionary<int, GroupCounts> counts)
    {
        var c = counts.TryGetValue(g.Id, out var hit) ? hit : EmptyCounts;
        return new PostcodeGroupDto(
            g.Id, g.Name, g.DepotId, g.Depot?.Name, g.ClientId, clientCode,
            c.Members, c.Zones, c.Polygons, c.DeliverySchedules, c.PickupSchedules);
    }

    /// <summary>
    /// Counts for a set of groups, in four queries rather than per row.
    /// Grouping happens in memory on purpose: the row counts are small
    /// (4,127 member rows on the largest tenant) and EF's InMemory
    /// provider, which the tests run on, does not translate a nested
    /// Select().Distinct().Count() inside a GroupBy.
    ///
    /// The member source is tenant-dependent. BulkZonePostcode on NZ,
    /// ZoneZip on US via FK_ZoneZip_BulkZonePostcodeGroup. Counting only
    /// BulkZonePostcode reads 0 for every group on a US tenant.
    /// </summary>
    private async Task<Dictionary<int, GroupCounts>> LoadGroupCountsAsync(List<int> ids)
    {
        if (ids.Count == 0) return new Dictionary<int, GroupCounts>();

        var members = IsUsTenant()
            ? await Context.ZoneZips.AsNoTracking()
                .Where(z => z.ZoneZipGroupId != null && ids.Contains(z.ZoneZipGroupId.Value))
                .Select(z => new { GroupId = z.ZoneZipGroupId.Value, Zone = z.ZoneNumber ?? 0 })
                .ToListAsync()
            : await Context.BulkZonePostcodes.AsNoTracking()
                .Where(p => p.PostcodeGroupId != null && ids.Contains(p.PostcodeGroupId.Value))
                .Select(p => new { GroupId = p.PostcodeGroupId.Value, Zone = p.Zone })
                .ToListAsync();

        var polygons = await (
                from zp in Context.BulkZonePolygons.AsNoTracking()
                join p in Context.BulkRunPolygons.AsNoTracking()
                    on zp.PolygonId equals p.PolygonId
                where zp.Active && p.Active && ids.Contains(zp.PostcodeGroupId)
                select new { GroupId = zp.PostcodeGroupId })
            .ToListAsync();

        // Both sides in one pass. A day row can reference the same group on
        // both sides, which is why they are read together rather than as two
        // filtered queries that would double-count nothing but cost twice.
        // Through the view for the same reason as GetPostcodeGroupDetailAsync:
        // on the day table a converted schedule reads as using no group at all.
        var dayRows = await Context.TblBulkRunSchedules.AsNoTracking()
            .Where(d => (d.PostcodeGroupId != null && ids.Contains(d.PostcodeGroupId.Value))
                     || (d.PickupPostcodeGroupId != null && ids.Contains(d.PickupPostcodeGroupId.Value)))
            .Select(d => new { d.ScheduleId, d.PostcodeGroupId, d.PickupPostcodeGroupId })
            .ToListAsync();

        var memberByGroup = members.GroupBy(m => m.GroupId)
            .ToDictionary(g => g.Key, g => (Count: g.Count(), Zones: g.Select(x => x.Zone).Distinct().Count()));
        var polyByGroup = polygons.GroupBy(p => p.GroupId).ToDictionary(g => g.Key, g => g.Count());
        var idSet = new HashSet<int>(ids);
        var delByGroup = dayRows
            .Where(d => d.PostcodeGroupId.HasValue && idSet.Contains(d.PostcodeGroupId.Value))
            .GroupBy(d => d.PostcodeGroupId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ScheduleId).Distinct().Count());
        var pickByGroup = dayRows
            .Where(d => d.PickupPostcodeGroupId.HasValue && idSet.Contains(d.PickupPostcodeGroupId.Value))
            .GroupBy(d => d.PickupPostcodeGroupId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ScheduleId).Distinct().Count());

        return ids.Distinct().ToDictionary(id => id, id =>
        {
            var hasMembers = memberByGroup.TryGetValue(id, out var m);
            return new GroupCounts(
                hasMembers ? m.Count : 0,
                hasMembers ? m.Zones : 0,
                polyByGroup.TryGetValue(id, out var p) ? p : 0,
                delByGroup.TryGetValue(id, out var d) ? d : 0,
                pickByGroup.TryGetValue(id, out var k) ? k : 0);
        });
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

    /// <summary>
    /// Driver location lists for the zone group form's Clear-List Area
    /// picker, in the tenant's own order. Not tenant-gated: NZ tenants carry
    /// the table too, and the list is just whatever is there.
    /// </summary>
    public async Task<List<ClearListAreaDto>> GetClearListAreasAsync() =>
        await Context.TblClearListAreas.AsNoTracking()
            .OrderBy(a => a.Order)
            .ThenBy(a => a.Name)
            .Select(a => new ClearListAreaDto(a.ClearListAreaId, a.Code, a.Name))
            .ToListAsync();

    private bool IsUsTenant()
    {
        var countryCode = httpContextAccessor.HttpContext?.User
            .FindFirstValue("CountryCode");
        return string.Equals(countryCode, "US", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Tenants that use ZoneGroup / ZoneName: US and AU.</summary>
    private bool HasZoneGroups()
    {
        var countryCode = httpContextAccessor.HttpContext?.User
            .FindFirstValue("CountryCode");
        return string.Equals(countryCode, "US", StringComparison.OrdinalIgnoreCase)
            || string.Equals(countryCode, "AU", StringComparison.OrdinalIgnoreCase);
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
    /// Copy a group and its zone membership (spec 3.2).
    ///
    /// The membership is the whole point: a group row on its own carries no
    /// force, it is the postcodes, the schedules pointing at it and the rates
    /// hanging off it that do. Schedules are deliberately NOT copied, because a
    /// duplicate is a new territory and attaching it to the original's
    /// schedules would change what those schedules serve. Rates are not copied
    /// either; that checkbox lands with the Pricing tab.
    /// </summary>
    public async Task<PostcodeGroupDuplicateResultDto> DuplicatePostcodeGroupAsync(
        int id, PostcodeGroupDuplicateRequest req)
    {
        RequireName(req.Name);

        var source = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .FirstOrDefaultAsync(g => g.Id == id)
            ?? throw new InvalidOperationException("Postcode group not found.");

        var name = req.Name.Trim();

        // Retarget only where asked. An empty-string ClientCode is an explicit
        // "make this one client-agnostic", which is different from omitting it.
        var clientId = source.ClientId;
        if (req.ClientCode != null || req.ClientId.HasValue)
            clientId = req.ClientCode is { Length: 0 } ? null : await ResolveClientAsync(req.ClientCode, req.ClientId);

        var depotId = req.DepotId ?? source.DepotId;

        // The same name on another depot is the normal shape here, not a
        // mistake: 10 of Urgent's 58 groups share a name, HelloFresh across
        // seven depots and Chilled Zones across three, and carrying a group to
        // a new depot under its own name is the main thing Duplicate is for.
        // So only an exact name + depot + client collision is refused, which
        // is the one case no screen could tell the two rows apart.
        if (await Context.BulkZonePostcodeGroups.AsNoTracking()
                .AnyAsync(g => g.Name == name && g.DepotId == depotId && g.ClientId == clientId))
            throw new InvalidOperationException(
                $"A postcode group called \"{name}\" already sits on this depot for the same client, "
                + "and nothing on screen would tell the two apart. Change the name, the depot or the client.");

        var copy = new Domain.Despatch.BulkZonePostcodeGroup
        {
            Name = name,
            DepotId = depotId,
            ClientId = clientId,
        };
        Context.BulkZonePostcodeGroups.Add(copy);
        await Context.SaveChangesAsync();

        var now = DateTime.UtcNow;
        int membersCopied;
        int zonesCopied;

        if (IsUsTenant())
        {
            var rows = await Context.ZoneZips.AsNoTracking()
                .Where(z => z.ZoneZipGroupId == id)
                .ToListAsync();
            Context.ZoneZips.AddRange(rows.Select(z => new Domain.Despatch.ZoneZip
            {
                ZoneNameId = z.ZoneNameId,
                Zip = z.Zip,
                ZoneNumber = z.ZoneNumber,
                ApplyCongestion = z.ApplyCongestion,
                ClientId = z.ClientId,
                ZoneZipGroupId = copy.Id,
                Created = now,
                CreatedBy = CurrentUser(),
            }));
            membersCopied = rows.Count;
            zonesCopied = rows.Select(z => z.ZoneNumber ?? 0).Distinct().Count();
        }
        else
        {
            var rows = await Context.BulkZonePostcodes.AsNoTracking()
                .Where(p => p.PostcodeGroupId == id)
                .ToListAsync();
            Context.BulkZonePostcodes.AddRange(rows.Select(p => new Domain.Despatch.BulkZonePostcode
            {
                PostCode = p.PostCode,
                Zone = p.Zone,
                // The copy's depot wins when it was retargeted, so a group
                // duplicated onto another depot does not keep rows pointing at
                // the old one.
                DepotId = req.DepotId ?? p.DepotId,
                PostcodeGroupId = copy.Id,
                FromSiteId = p.FromSiteId,
                Name = p.Name,
                FromLatLng = p.FromLatLng,
                Created = now,
            }));
            membersCopied = rows.Count;
            zonesCopied = rows.Select(p => p.Zone).Distinct().Count();
        }

        if (membersCopied > 0) await Context.SaveChangesAsync();

        // Polygons copy the same way postcodes do: a new membership row per
        // shape, same PolygonId, same zone. The shape itself is not cloned and
        // is not moved, because BulkZonePolygon is unique on
        // (PostcodeGroupId, PolygonId) rather than on PolygonId alone, so one
        // shape can be Zone 4 here and Zone 2 in the copy's group without
        // either group losing it. Spec 3.1, migration 20261007170000.
        var polygonMembers = await Context.BulkZonePolygons.AsNoTracking()
            .Where(zp => zp.Active && zp.PostcodeGroupId == id)
            .Select(zp => new { zp.PolygonId, zp.Zone })
            .ToListAsync();

        if (polygonMembers.Count > 0)
        {
            var actor = CurrentUser();
            Context.BulkZonePolygons.AddRange(polygonMembers.Select(m =>
                new Domain.Despatch.BulkZonePolygon
                {
                    PostcodeGroupId = copy.Id,
                    PolygonId = m.PolygonId,
                    Zone = m.Zone,
                    Active = true,
                    CreatedUtc = DateTime.UtcNow,
                    CreatedBy = actor,
                }));
            await Context.SaveChangesAsync();
        }

        return new PostcodeGroupDuplicateResultDto(
            await GetPostcodeGroupAsync(copy.Id),
            membersCopied,
            zonesCopied,
            polygonMembers.Count);
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

        // The FK on tblBulkRunScheduleDay.PostcodeGroupId cannot protect a
        // converted schedule, whose group ids live on its detail row with no FK
        // and whose day columns are NULL. Pickup group columns never had an FK.
        // Retired schedules are deliberately included, as the FK included them.
        var usedBy = await Context.TblBulkRunSchedules.AsNoTracking()
            .Where(d => d.PostcodeGroupId == id || d.PickupPostcodeGroupId == id)
            .Select(d => new { d.ScheduleId, d.Name })
            .Distinct()
            .ToListAsync();
        // The view hides days a converted schedule's weekday mask switches
        // off, so a schedule with every day masked would not show above.
        // Read the detail rows directly as well so it still counts.
        var seen = usedBy.Select(s => s.ScheduleId).ToHashSet();
        var detailOnly = await Context.BulkRunScheduleDetails.AsNoTracking()
            .Where(x => x.PostcodeGroupId == id || x.PickupPostcodeGroupId == id)
            .Select(x => x.ScheduleId)
            .ToListAsync();
        detailOnly = detailOnly.Where(sid => !seen.Contains(sid)).ToList();
        if (detailOnly.Count > 0)
        {
            var extra = await Context.BulkRunScheduleHeaders.AsNoTracking()
                .Where(h => detailOnly.Contains(h.ScheduleId))
                .Select(h => new { h.ScheduleId, h.Name })
                .ToListAsync();
            usedBy.AddRange(extra);
            usedBy.AddRange(detailOnly
                .Where(sid => extra.All(e => e.ScheduleId != sid))
                .Select(sid => new { ScheduleId = sid, Name = (string)null }));
        }
        if (usedBy.Count > 0)
        {
            const int maxNames = 5;
            var count = usedBy.Select(s => s.ScheduleId).Distinct().Count();
            var names = string.Join(", ", usedBy
                .GroupBy(s => s.ScheduleId)
                .Select(s => s.Select(x => x.Name).FirstOrDefault(n => !string.IsNullOrWhiteSpace(n)) ?? $"#{s.Key}")
                .OrderBy(n => n)
                .Take(maxNames));
            var more = count > maxNames ? $" and {count - maxNames} more" : "";
            throw new InvalidOperationException(
                $"This postcode group is used by {count} schedule{(count == 1 ? "" : "s")} ({names}{more}). Remove it from those schedules first.");
        }

        Context.BulkZonePostcodeGroups.Remove(entity);
        await Context.SaveChangesAsync();
    }

    private async Task<PostcodeGroupDto> GetPostcodeGroupAsync(int id)
    {
        var g = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .Include(x => x.Depot)
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
        // Same counts as the list, so a row does not change shape the
        // moment it is edited.
        return ToDto(g, clientCode, await LoadGroupCountsAsync(new List<int> { id }));
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
        await using var tx = await BeginGroupWriteAsync();
        await LockGroupRowsAsync(req.PostcodeGroupId);
        Context.BulkZonePostcodes.Add(entity);
        await Context.SaveChangesAsync();
        var dto = await GetNzPostcodeAsync(entity.Id);
        await CommitGroupWriteAsync(tx);
        return dto;
    }

    public async Task<NzPostcodeDto> UpdateNzPostcodeAsync(int id, NzPostcodeUpsertRequest req)
    {
        await using var tx = await BeginGroupWriteAsync();
        // The row can leave one group and join another, so both are locked;
        // nit 5: its group is read again under the lock.
        await ZoneGroupLocks.LockRowGroupAsync(() => NzGroupOfAsync(id), req.PostcodeGroupId, LockGroupRowsAsync);
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
        var dto = await GetNzPostcodeAsync(id);
        await CommitGroupWriteAsync(tx);
        return dto;
    }

    public async Task DeleteNzPostcodeAsync(int id)
    {
        await using var tx = await BeginGroupWriteAsync();
        await ZoneGroupLocks.LockRowGroupAsync(() => NzGroupOfAsync(id), null, LockGroupRowsAsync);
        var entity = await Context.BulkZonePostcodes
            .FirstOrDefaultAsync(p => p.Id == id)
            ?? throw new InvalidOperationException("Postcode not found.");
        Context.BulkZonePostcodes.Remove(entity);
        await Context.SaveChangesAsync();
        await CommitGroupWriteAsync(tx);
    }

    private Task<int?> NzGroupOfAsync(int id) =>
        Context.BulkZonePostcodes.AsNoTracking()
            .Where(p => p.Id == id).Select(p => (int?)p.PostcodeGroupId).FirstOrDefaultAsync();

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

    /// <summary>
    /// Add many NZ postcodes to one zone of one group in a single call
    /// (spec 11.8).
    ///
    /// The rule that matters: a postcode already sitting in a DIFFERENT zone of
    /// the same group is reported, never moved. On Urgent production no
    /// postcode is in two zones of one group, and the rating function picks a
    /// zone by (group, postcode), so quietly moving one would reprice every
    /// schedule that ticks either zone.
    /// </summary>
    public async Task<NzPostcodePasteResultDto> PasteNzPostcodesAsync(
        int groupId, int zone, NzPostcodePasteRequest req)
    {
        // Review r2: the check against the group's rows and the insert are
        // one transaction holding the group lock, so a paste queues behind a
        // CSV apply on the same group instead of landing inside it.
        await using var tx = await BeginGroupWriteAsync();
        await LockGroupRowsAsync(groupId);

        var group = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .FirstOrDefaultAsync(g => g.Id == groupId)
            ?? throw new InvalidOperationException("Postcode group not found.");

        if (zone <= 0)
            throw new InvalidOperationException(
                "A zone number is required. A row with no zone cannot be reached by a schedule tick.");

        // Same separators as the US paste and the postcode pickers, so the two
        // behave identically to whoever is pasting.
        var ignored = new List<string>();
        var wanted = new List<int>();
        foreach (var raw in (req.Postcodes ?? new List<string>())
                     .SelectMany(s => (s ?? "").Split(
                         new[] { ',', ' ', ';', '\t', '\n', '\r' },
                         StringSplitOptions.RemoveEmptyEntries)))
        {
            var text = raw.Trim();
            // NZ codes are four digits and the column is an int, so 0110 is
            // stored as 110. Anything longer than four digits is not a
            // postcode and anything non-numeric never was.
            if (text.Length is > 0 and <= 4 && text.All(char.IsDigit) && int.TryParse(text, out var code) && code > 0)
            {
                if (!wanted.Contains(code)) wanted.Add(code);
            }
            else if (!ignored.Contains(text))
            {
                ignored.Add(text);
            }
        }

        var inGroup = await Context.BulkZonePostcodes.AsNoTracking()
            .Where(p => p.PostcodeGroupId == groupId && wanted.Contains(p.PostCode))
            .Select(p => new { p.PostCode, p.Zone, p.Name })
            .ToListAsync();

        var alreadyHere = inGroup.Where(p => p.Zone == zone)
            .Select(p => p.PostCode).Distinct().ToList();
        var elsewhere = inGroup.Where(p => p.Zone != zone)
            .GroupBy(p => p.PostCode)
            .Select(grp => new PostcodeInOtherZoneDto(
                grp.Key.ToString("D4"),
                grp.First().Zone,
                grp.Select(x => x.Name).FirstOrDefault(n => !string.IsNullOrWhiteSpace(n))))
            .OrderBy(x => x.Code)
            .ToList();

        var blocked = elsewhere.Select(x => int.Parse(x.Code)).ToHashSet();
        var toAdd = wanted.Where(c => !alreadyHere.Contains(c) && !blocked.Contains(c)).ToList();

        if (toAdd.Count > 0)
        {
            // Inherit the suburb label from the same postcode elsewhere in the
            // tenant when the caller did not supply one. BulkZonePostcode.Name
            // already carries it on 2,909 of Urgent's 3,025 rows, which is why
            // this needs no suburb lookup table. The other 116 rows carry an
            // empty string, not NULL, because the column is NOT NULL on the
            // live table, so an unknown suburb has to fall back to "" here.
            var supplied = string.IsNullOrWhiteSpace(req.Name) ? null : req.Name.Trim();
            var inherited = supplied != null
                ? new Dictionary<int, string>()
                : (await Context.BulkZonePostcodes.AsNoTracking()
                        .Where(p => toAdd.Contains(p.PostCode) && p.Name != null && p.Name != "")
                        .Select(p => new { p.PostCode, p.Name })
                        .ToListAsync())
                    .GroupBy(p => p.PostCode)
                    .ToDictionary(grp => grp.Key, grp => grp.First().Name);

            var now = DateTime.UtcNow;
            Context.BulkZonePostcodes.AddRange(toAdd.Select(code => new Domain.Despatch.BulkZonePostcode
            {
                PostCode = code,
                Zone = zone,
                DepotId = req.DepotId ?? group.DepotId,
                PostcodeGroupId = groupId,
                FromSiteId = 0,
                Name = supplied ?? (inherited.TryGetValue(code, out var n) ? n : string.Empty),
                Created = now,
            }));
            await Context.SaveChangesAsync();
        }
        await CommitGroupWriteAsync(tx);

        return new NzPostcodePasteResultDto(
            toAdd.OrderBy(c => c).Select(c => c.ToString("D4")).ToList(),
            elsewhere,
            alreadyHere.OrderBy(c => c).Select(c => c.ToString("D4")).ToList(),
            ignored);
    }

    // ─── ZONE GROUP CSV RE-UPLOAD (F4 / ZG3) ────────────────────────────────

    /// <summary>
    /// Preview a re-uploaded zone group export: added, moved, removed and
    /// unrecognised, plus a token naming the exact group state it was worked
    /// out against. Writes nothing.
    ///
    /// NZ reads BulkZonePostcode by PostcodeGroupId; US reads ZoneZip by
    /// ZoneZipGroupId (which points at BulkZonePostcodeGroup), the same rows
    /// the group detail and the export show. On US the export's third column
    /// is the zone NAME, not a suburb, and is ignored here: a ZIP takes its
    /// zone name from the group's own rows for that zone number.
    /// </summary>
    public async Task<ZoneGroupCsvImport.ZoneGroupImportPreview> PreviewZoneGroupImportAsync(
        int groupId, ZoneGroupImportRequest req)
    {
        var state = await LoadImportStateAsync(groupId);
        return await BuildImportPreviewAsync(state, req);
    }

    /// <summary>
    /// Apply a re-upload. The file is parsed and diffed again here, never
    /// taken from the browser, and the apply refuses when:
    ///   * the file has any error (nothing is written, the rows are named);
    ///   * the group no longer matches the preview's token, because the
    ///     operator approved a diff against a group that has since changed.
    /// Rows missing from the file are deleted only with RemoveMissing (M0
    /// I-6); otherwise they stay and are counted as kept. One transaction, so
    /// a failure part way leaves the group as it was.
    /// </summary>
    public async Task<ZoneGroupImportResultDto> ApplyZoneGroupImportAsync(int groupId, ZoneGroupImportRequest req)
    {
        await using var tx = await Context.Database.BeginTransactionAsync();
        await LockGroupForImportAsync(groupId);

        var state = await LoadImportStateAsync(groupId);
        if (string.IsNullOrEmpty(req.Token) || req.Token != ImportToken(state.Current))
            throw new ZoneGroupImportStaleException();

        var preview = await BuildImportPreviewAsync(state, req);
        if (preview.Errors.Count > 0)
            throw new InvalidOperationException(
                "Nothing was saved. Fix the file and upload it again. " + string.Join(" ", preview.Errors));

        var now = DateTime.UtcNow;
        var removeIds = req.RemoveMissing ? preview.Removed.Select(r => r.Id).ToList() : new List<int>();
        var moveTo = preview.Moved.ToDictionary(m => m.Id, m => m.ToZone);

        if (state.IsUs)
        {
            var who = CurrentUser();
            var targets = ZoneTargets(state);
            var touched = moveTo.Keys.Concat(removeIds).ToList();
            var tracked = await Context.ZoneZips.Where(z => touched.Contains(z.ZoneZipId)).ToListAsync();
            foreach (var z in tracked.Where(z => moveTo.ContainsKey(z.ZoneZipId)))
            {
                z.ZoneNumber = moveTo[z.ZoneZipId];
                z.ZoneNameId = targets[z.ZoneNumber.Value].ZoneNameId;
                z.LastModified = now;
                z.LastModifiedBy = who;
            }
            Context.ZoneZips.RemoveRange(tracked.Where(z => removeIds.Contains(z.ZoneZipId)));
            Context.ZoneZips.AddRange(preview.Added.Select(a => new Domain.Despatch.ZoneZip
            {
                Zip = a.Code,
                ZoneNumber = a.Zone,
                ZoneNameId = targets[a.Zone].ZoneNameId,
                // The preview refused any add whose zone disagrees on client,
                // so this is the one ClientId every row of the zone carries.
                ClientId = targets[a.Zone].ClientId,
                // Same rule as the US paste (coverage spec 2.1): a coverage
                // row never adds a congestion charge.
                ApplyCongestion = false,
                ZoneZipGroupId = groupId,
                Created = now,
                CreatedBy = who,
                // Nit 1 / #980: a new row starts with LastModified = Created,
                // as CreateUsZipZoneAsync and AdminManager do.
                LastModified = now,
                LastModifiedBy = who,
            }));
        }
        else
        {
            var touched = moveTo.Keys.Concat(removeIds).ToList();
            var tracked = await Context.BulkZonePostcodes.Where(p => touched.Contains(p.Id)).ToListAsync();
            foreach (var p in tracked.Where(p => moveTo.ContainsKey(p.Id)))
                p.Zone = moveTo[p.Id];
            Context.BulkZonePostcodes.RemoveRange(tracked.Where(p => removeIds.Contains(p.Id)));

            // A blank suburb inherits the label from the same postcode
            // elsewhere in the tenant, the paste's rule; the column is NOT
            // NULL, so an unknown one is "".
            var addCodes = preview.Added.Select(a => int.Parse(a.Code)).ToList();
            var inherited = addCodes.Count == 0
                ? new Dictionary<int, string>()
                : (await Context.BulkZonePostcodes.AsNoTracking()
                        .Where(p => addCodes.Contains(p.PostCode) && p.Name != null && p.Name != "")
                        .Select(p => new { p.PostCode, p.Name })
                        .ToListAsync())
                    .GroupBy(p => p.PostCode)
                    .ToDictionary(g => g.Key, g => g.First().Name);

            Context.BulkZonePostcodes.AddRange(preview.Added.Select(a =>
            {
                var code = int.Parse(a.Code);
                return new Domain.Despatch.BulkZonePostcode
                {
                    PostCode = code,
                    Zone = a.Zone,
                    DepotId = state.DepotId,
                    PostcodeGroupId = groupId,
                    FromSiteId = 0,
                    Name = !string.IsNullOrWhiteSpace(a.Suburb) ? a.Suburb
                        : inherited.TryGetValue(code, out var n) ? n : string.Empty,
                    Created = now,
                };
            }));
        }

        await Context.SaveChangesAsync();
        await tx.CommitAsync();

        return new ZoneGroupImportResultDto(
            preview.Added.Count,
            preview.Moved.Count,
            removeIds.Count,
            preview.Removed.Count - removeIds.Count);
    }

    /// <summary>
    /// Review m2: the token is checked inside the transaction, but under READ
    /// COMMITTED another writer could still land between that check and the
    /// commit. On SQL Server this takes, to the end of the transaction:
    ///   * an update lock on the group row, so two applies, or an apply and a
    ///     Routed Operations paste or edit (which take the same lock), queue;
    ///   * a key-range lock on the group's members, so no row joins or leaves
    ///     the group until the commit;
    ///   * an update lock on each member's primary key (review r3-1), so a
    ///     zone change or delete by Id from a writer that skips the group lock,
    ///     such as a legacy admin screen, also waits for the commit.
    /// The range lock alone did not cover that last writer once the index
    /// migration 20261120190500_ZoneGroupMemberIndexes narrowed it to the
    /// group index. Nothing names that index, so this works with or without
    /// it; without it the range lock covers the whole table (3311 locks on
    /// local NZ), which is correct but blocks every other group's writers.
    /// SQLite locks the whole database for a write transaction, so the test
    /// harness needs nothing here. Detail in ZoneGroupLocks.
    /// </summary>
    private async Task LockGroupForImportAsync(int groupId)
    {
        if (!IsSqlServer()) return;
        await ZoneGroupLocks.LockGroupForImportAsync(Context.Database, groupId, IsUsTenant());
    }

    /// <summary>The transaction a single member write runs in, the same rule
    /// as ScheduleService: none on a non-relational provider (the InMemory
    /// test store), and none of its own when the caller already holds one,
    /// in which case the caller commits.</summary>
    private async Task<IDbContextTransaction> BeginGroupWriteAsync() =>
        Context.Database.IsRelational() && Context.Database.CurrentTransaction == null
            ? await Context.Database.BeginTransactionAsync()
            : null;

    private static Task CommitGroupWriteAsync(IDbContextTransaction tx) =>
        tx == null ? Task.CompletedTask : tx.CommitAsync();

    private bool IsSqlServer() =>
        Context.Database.ProviderName?.Contains("SqlServer", StringComparison.OrdinalIgnoreCase) == true;

    /// <summary>Review r2: the group-row lock every writer of a group's
    /// members takes before it reads the rows its write depends on (see
    /// ZoneGroupLocks.LockGroupRowsAsync). A no-op on SQLite.</summary>
    private Task LockGroupRowsAsync(params int?[] groupIds) =>
        IsSqlServer() ? ZoneGroupLocks.LockGroupRowsAsync(Context.Database, groupIds) : Task.CompletedTask;

    private sealed record ImportState(
        int GroupId, int? DepotId, bool IsUs,
        List<ZoneGroupCsvImport.CurrentRow> Current,
        List<(int Zone, int? ZoneNameId, int? ClientId)> UsZoneRows);

    private async Task<ImportState> LoadImportStateAsync(int groupId)
    {
        var group = await Context.BulkZonePostcodeGroups.AsNoTracking()
            .FirstOrDefaultAsync(g => g.Id == groupId)
            ?? throw new InvalidOperationException("Postcode group not found.");

        if (IsUsTenant())
        {
            var zips = await Context.ZoneZips.AsNoTracking()
                .Where(z => z.ZoneZipGroupId == groupId)
                .Select(z => new { z.ZoneZipId, z.Zip, z.ZoneNumber, z.ZoneNameId, z.ClientId })
                .ToListAsync();
            return new ImportState(groupId, group.DepotId, true,
                zips.Select(z => new ZoneGroupCsvImport.CurrentRow(z.ZoneZipId, UsZip(z.Zip), z.ZoneNumber ?? 0)).ToList(),
                zips.Select(z => (z.ZoneNumber ?? 0, z.ZoneNameId, z.ClientId)).ToList());
        }

        var pcs = await Context.BulkZonePostcodes.AsNoTracking()
            .Where(p => p.PostcodeGroupId == groupId)
            .Select(p => new { p.Id, p.PostCode, p.Zone })
            .ToListAsync();
        return new ImportState(groupId, group.DepotId, false,
            pcs.Select(p => new ZoneGroupCsvImport.CurrentRow(p.Id, p.PostCode.ToString("D4"), p.Zone)).ToList(),
            new());
    }

    // Matches the parse: a short all-digit ZIP is compared with its zero back.
    private static string UsZip(string zip)
    {
        var z = (zip ?? "").Trim();
        return z.Length is > 0 and < 5 && z.All(char.IsAsciiDigit) ? z.PadLeft(5, '0') : z;
    }

    private async Task<ZoneGroupCsvImport.ZoneGroupImportPreview> BuildImportPreviewAsync(
        ImportState state, ZoneGroupImportRequest req)
    {
        // Review M3: the same spelling guard as the US paste. The upload pads
        // every ZIP to 5, so on a tenant that stores any ZIP unpadded it
        // would put one ZIP in two zones depending on its spelling.
        if (state.IsUs && await FirstUnpaddedZipAsync() is { } stripped)
            return new ZoneGroupCsvImport.ZoneGroupImportPreview(new(), new(), new(), new(), 0,
                new List<string>
                {
                    $"This tenant stores at least one ZIP unpadded (\"{stripped}\"). Uploading padded ZIPs "
                    + "would leave the same ZIP in different zones depending on its spelling, so nothing "
                    + "can be applied. Settle the tenant's spelling first.",
                },
                ImportToken(state.Current));

        var parsed = ZoneGroupCsvImport.Parse(req.Csv, state.IsUs);

        // "Known" (M0 I-5): the right shape for the tenant AND used somewhere
        // in the tenant already. Only asked about codes the group lacks.
        var inGroup = state.Current.Select(c => c.Code).ToHashSet();
        var candidates = parsed.Rows.Select(r => r.Code).Where(c => !inGroup.Contains(c)).Distinct().ToList();
        HashSet<string> known;
        if (candidates.Count == 0) known = new();
        else if (state.IsUs)
            known = (await Context.ZoneZips.AsNoTracking()
                    .Where(z => candidates.Contains(z.Zip)).Select(z => z.Zip).Distinct().ToListAsync())
                .ToHashSet();
        else
        {
            var ints = candidates.Where(c => c.Length == 4).Select(int.Parse).ToList();
            known = (await Context.BulkZonePostcodes.AsNoTracking()
                    .Where(p => ints.Contains(p.PostCode)).Select(p => p.PostCode).Distinct().ToListAsync())
                .Select(c => c.ToString("D4")).ToHashSet();
        }
        var size = state.IsUs ? 5 : 4;

        var preview = ZoneGroupCsvImport.Diff(state.Current, parsed, c => c.Length == size && known.Contains(c));

        if (state.IsUs && preview.Errors.Count == 0)
        {
            // A US ZIP joins a zone by taking the zone name the group already
            // uses for that number. A number the group does not have, or one
            // carrying two names, has no answer, so it is an error rather than
            // a guess at which ZoneName (and so which depot and lanes) to use.
            //
            // An added ZIP also takes the zone's client, so a zone whose rows
            // carry more than one ClientId refuses the add rather than copy
            // whichever row came first (review M3). A move keeps its own
            // client, so it only needs the zone name.
            var targets = ZoneTargets(state);
            var problems = preview.Added.Select(a => (a.Line, a.Code, a.Zone, IsAdd: true))
                .Concat(preview.Moved.Select(m => (m.Line, m.Code, Zone: m.ToZone, IsAdd: false)))
                .Where(t => !targets.ContainsKey(t.Zone) || (t.IsAdd && !targets[t.Zone].OneClient))
                .OrderBy(t => t.Line)
                .Select(t => targets.ContainsKey(t.Zone)
                    ? $"Row {t.Line}: zone {t.Zone}'s ZIPs in this group belong to more than one client, so "
                      + $"there is no single client to give {t.Code}. Settle zone {t.Zone} in the group first."
                    : state.UsZoneRows.Any(r => r.Zone == t.Zone)
                    ? $"Row {t.Line}: zone {t.Zone} carries more than one zone name in this group, so there is "
                      + $"no single one to put {t.Code} under. Settle zone {t.Zone} in the group first."
                    : $"Row {t.Line}: zone {t.Zone} has no ZIPs in this group yet, so there is no zone name "
                      + $"to put {t.Code} under. Add zone {t.Zone}'s first ZIP in the group (Zones tab), "
                      + "then upload the file again.")
                .Distinct()
                .ToList();
            // Nit 4: an empty group would repeat that for every zone, so it
            // gets one message. The file cannot start a zone, because a new
            // ZIP needs a zone name and only the group's own ZIPs give one.
            if (problems.Count > 0 && state.UsZoneRows.Count == 0)
                problems = new List<string>
                {
                    "This group has no ZIPs yet. A ZIP takes its zone name from the group's own ZIPs in that "
                    + "zone, so add each zone's first ZIP in the group (Zones tab), then upload the file again.",
                };
            if (problems.Count > 0)
                preview = new ZoneGroupCsvImport.ZoneGroupImportPreview(new(), new(), new(), new(), 0, problems, null);
        }

        return preview with { Token = ImportToken(state.Current) };
    }

    /// <summary>US zone number -> the one ZoneName the group's rows for that
    /// number carry, and their client when they all agree on one (OneClient).
    /// Numbers with two names are left out.</summary>
    private static Dictionary<int, (int? ZoneNameId, int? ClientId, bool OneClient)> ZoneTargets(ImportState state) =>
        state.UsZoneRows.GroupBy(r => r.Zone)
            .Where(g => g.Select(r => r.ZoneNameId).Distinct().Count() == 1)
            .ToDictionary(g => g.Key, g => (
                g.First().ZoneNameId,
                g.First().ClientId,
                g.Select(r => r.ClientId).Distinct().Count() == 1));

    /// <summary>Names the group's exact rows (id, code, zone). Any add, move or
    /// delete in between changes it.</summary>
    private static string ImportToken(List<ZoneGroupCsvImport.CurrentRow> current)
    {
        var text = string.Join("|", current.OrderBy(c => c.Id).Select(c => $"{c.Id}:{c.Code}:{c.Zone}"));
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text)));
    }

    // ─── US ZIP ZONE WRITES ────────────────────────────────────────────────

    /// <summary>
    /// Add many ZIPs to one US zone in a single call (US coverage spec 5.3).
    ///
    /// The single-row endpoint means 602 form submissions for Cheetah's Hub
    /// Group file, which is why this exists.
    ///
    /// The row rules come from section 2.1 and exist so a coverage zone never
    /// moves a price. Three things the rater reads off ZoneZip ignore which
    /// zone the row belongs to:
    ///   * the congestion flag, so these rows are written with it off;
    ///   * "only in zips" distance rates, which turn on a ZIP having ANY zone
    ///     row (there are none on OTG or Cheetah today, measured 27 Oct);
    ///   * the depot lookup, which takes every zone's depot, and that is the
    ///     intended meaning of a depot on a zone rather than a side effect.
    ///
    /// A ZIP already in another zone is added here as well, not moved: on US a
    /// ZIP sitting in one pricing zone plus any number of coverage zones is
    /// the normal shape, and the rater matches lanes against the whole list.
    ///
    /// Review r2: no group lock here. This paste writes ZoneZipGroupId = null,
    /// so it never adds a member to a zone group and cannot land inside a CSV
    /// apply's view of one. The US writers that do set ZoneZipGroupId
    /// (Create/Update/DeleteUsZipZoneAsync) take the lock.
    /// </summary>
    public async Task<ZoneZipPasteResultDto> PasteZoneZipsAsync(int zoneNameId, ZoneZipPasteRequest req)
    {
        var zone = await Context.ZoneNames.AsNoTracking()
            .FirstOrDefaultAsync(z => z.ZoneNameId == zoneNameId)
            ?? throw new InvalidOperationException("Zone name not found.");

        if (req.ZoneNumber <= 0)
            throw new InvalidOperationException("A zone number is required.");

        // Spelling. Every US tenant measured on 27 Oct stores a 5-character
        // ZIP with the leading zero kept: OTG 1,269 of 1,269, Cheetah 1,281 of
        // 1,281, and the seed 4,420 of 4,427 (its 7 odd ones are 7-digit junk,
        // not a shorter spelling). So padding to 5 is the convention, not a
        // guess. If a tenant ever turns out to strip instead, mixing the two
        // spellings would put one ZIP in different zones depending on how it
        // was typed, so that case refuses rather than guessing.
        var stripped = await FirstUnpaddedZipAsync();
        if (stripped != null)
            throw new InvalidOperationException(
                $"This tenant stores at least one ZIP unpadded (\"{stripped}\"). Adding padded rows "
                + "would leave the same ZIP in different zones depending on its spelling, so the "
                + "paste has stopped. Settle the tenant's spelling first.");

        // The shared-number guard. Legitimate, but it widens what a tick
        // covers, so it is opt-in rather than silent. A zone with no depot has
        // no depot to collide at, and cannot be matched by the availability
        // function either way.
        if (!req.AllowSharedNumber && zone.LocationId != null)
        {
            var clash = await Context.ZoneZips.AsNoTracking()
                .Where(z => z.ZoneNumber == req.ZoneNumber
                         && z.ZoneNameId != zoneNameId
                         && z.ZoneName != null
                         && z.ZoneName.LocationId == zone.LocationId)
                .Select(z => z.ZoneName.ZoneName1)
                .Distinct()
                .ToListAsync();

            if (clash.Count > 0)
                throw new InvalidOperationException(
                    $"Zone number {req.ZoneNumber} is already used at this depot by "
                    + $"{string.Join(", ", clash)}. A schedule ticking {req.ZoneNumber} would then "
                    + "serve both zones. Pick an unused number, or resend with allowSharedNumber to "
                    + "mean both.");
        }

        // Normalise once, server-side, so the stored spelling does not depend
        // on which client called. Same separators as the postcode pickers.
        var ignored = new List<string>();
        var wanted = new List<string>();
        foreach (var raw in (req.Zips ?? new List<string>())
                     .SelectMany(s => (s ?? "").Split(
                         new[] { ',', ' ', ';', '\t', '\n', '\r' },
                         StringSplitOptions.RemoveEmptyEntries)))
        {
            var zip = raw.Trim();
            if (zip.Length is > 0 and < 5 && zip.All(char.IsDigit)) zip = zip.PadLeft(5, '0');
            if (zip.Length == 5 && zip.All(char.IsDigit))
            {
                if (!wanted.Contains(zip)) wanted.Add(zip);
            }
            else if (!ignored.Contains(raw.Trim()))
            {
                ignored.Add(raw.Trim());
            }
        }

        var existing = await Context.ZoneZips.AsNoTracking()
            .Where(z => z.ZoneNameId == zoneNameId)
            .Select(z => z.Zip)
            .ToListAsync();
        var already = wanted.Where(z => existing.Contains(z)).ToList();
        var toAdd = wanted.Where(z => !existing.Contains(z)).ToList();

        if (toAdd.Count > 0)
        {
            var now = DateTime.UtcNow;
            var who = CurrentUser();
            Context.ZoneZips.AddRange(toAdd.Select(zip => new Domain.Despatch.ZoneZip
            {
                ZoneNameId = zoneNameId,
                Zip = zip,
                ZoneNumber = req.ZoneNumber,
                // 2.1: a coverage row never adds a congestion charge.
                ApplyCongestion = false,
                ClientId = req.ClientId,
                // Nothing on master reads ZoneZipGroupId and Zip Groups stay
                // hidden on US, so it is left unset rather than invented.
                ZoneZipGroupId = null,
                Created = now,
                CreatedBy = who,
            }));
            await Context.SaveChangesAsync();
        }

        return new ZoneZipPasteResultDto(toAdd, already, ignored);
    }

    /// <summary>A ZIP the tenant stores shorter than 5 characters, or null.
    /// The paste and the zone group upload both stop on one.</summary>
    private Task<string> FirstUnpaddedZipAsync() =>
        Context.ZoneZips.AsNoTracking()
            .Where(z => z.Zip != null && z.Zip.Length > 0 && z.Zip.Length < 5)
            .Select(z => z.Zip)
            .FirstOrDefaultAsync();

    public async Task<UsZipZoneDto> CreateUsZipZoneAsync(UsZipZoneUpsertRequest req)
    {
        // #980: a new row starts with LastModified = Created, as AdminManager does.
        var now = DateTime.UtcNow;
        var who = CurrentUser();
        var entity = new Domain.Despatch.ZoneZip
        {
            Zip = req.Zip,
            ZoneNumber = req.ZoneNumber,
            ZoneNameId = req.ZoneNameId,
            ZoneZipGroupId = req.ZoneZipGroupId,
            ApplyCongestion = req.ApplyCongestion,
            ClientId = req.ClientId,
            Created = now,
            CreatedBy = who,
            LastModified = now,
            LastModifiedBy = who,
        };
        await using var tx = await BeginGroupWriteAsync();
        await LockGroupRowsAsync(req.ZoneZipGroupId);
        Context.ZoneZips.Add(entity);
        await Context.SaveChangesAsync();
        var dto = await GetUsZipZoneAsync(entity.ZoneZipId);
        await CommitGroupWriteAsync(tx);
        return dto;
    }

    public async Task<UsZipZoneDto> UpdateUsZipZoneAsync(int id, UsZipZoneUpsertRequest req)
    {
        await using var tx = await BeginGroupWriteAsync();
        // Old and new group, the old one read again under the lock (nit 5).
        await ZoneGroupLocks.LockRowGroupAsync(() => UsGroupOfAsync(id), req.ZoneZipGroupId, LockGroupRowsAsync);
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
        entity.LastModifiedBy = CurrentUser();
        await Context.SaveChangesAsync();
        var dto = await GetUsZipZoneAsync(id);
        await CommitGroupWriteAsync(tx);
        return dto;
    }

    public async Task DeleteUsZipZoneAsync(int id)
    {
        await using var tx = await BeginGroupWriteAsync();
        await ZoneGroupLocks.LockRowGroupAsync(() => UsGroupOfAsync(id), null, LockGroupRowsAsync);
        var entity = await Context.ZoneZips
            .FirstOrDefaultAsync(z => z.ZoneZipId == id)
            ?? throw new InvalidOperationException("Zip zone not found.");
        Context.ZoneZips.Remove(entity);
        await Context.SaveChangesAsync();
        await CommitGroupWriteAsync(tx);
    }

    private Task<int?> UsGroupOfAsync(int id) =>
        Context.ZoneZips.AsNoTracking()
            .Where(z => z.ZoneZipId == id).Select(z => (int?)z.ZoneZipGroupId).FirstOrDefaultAsync();

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
        // #980: a new row starts with LastModified = Created, as AdminManager does.
        var now = DateTime.UtcNow;
        var who = CurrentUser();
        var entity = new Domain.Despatch.ZoneName
        {
            ZoneName1 = req.Name.Trim(),
            ZoneGroupId = req.ZoneGroupId,
            LocationId = req.LocationId,
            Created = now,
            CreatedBy = who,
            LastModified = now,
            LastModifiedBy = who,
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
        entity.LastModifiedBy = CurrentUser();
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
        // #980: a new row starts with LastModified = Created, as AdminManager does.
        var now = DateTime.UtcNow;
        var who = CurrentUser();
        var entity = new Domain.Despatch.ZoneGroup
        {
            Name = req.Name.Trim(),
            ClearListAreaId = req.ClearListAreaId,
            Created = now,
            CreatedBy = who,
            LastModified = now,
            LastModifiedBy = who,
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
        entity.LastModifiedBy = CurrentUser();
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

    /// <summary>
    /// Who to stamp on a territory write, same resolution order as
    /// RecurringRouteService.
    ///
    /// The US territory tables all carry CreatedBy / LastModifiedBy and
    /// the legacy AdminManager screen fills them on every row: measured
    /// 23 Oct on DFRNT_SEED_CR, 26 of 26 ZoneGroup, 77 of 77 ZoneName
    /// and 4,427 of 4,427 ZoneZip rows had a name on them ("MikeS",
    /// "kerrant", "seed"). Routed Operations was stamping the timestamp
    /// and not the name, so anything created or edited here was the
    /// only row on the tenant with no author - which is exactly the
    /// row someone would want the author of.
    /// </summary>
    private string CurrentUser()
    {
        var user = httpContextAccessor.HttpContext?.User;
        return user?.FindFirstValue(ClaimTypes.Email)
            ?? user?.FindFirstValue(ClaimTypes.Name)
            ?? "system";
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
