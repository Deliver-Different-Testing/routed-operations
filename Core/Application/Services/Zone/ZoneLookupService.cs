using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Zone;
using RoutedOperations.Core.Domain;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Zone;

/// <summary>
/// Read-only rating-geography reader for the Polygon Builder "VIEW Zones"
/// drawer. Tenant-aware: US path reads ZoneName + ZoneZip, NZ path reads
/// BulkZonePostcode + BulkZonePostcodeGroup. Country switch is driven by
/// the "CountryCode" claim - **only** literal "US" triggers the US path,
/// everything else (including a missing claim) falls back to NZ. This
/// inversion of Client Manager's US-default helper is deliberate per the
/// George / product spec 2026-07-30 (safer for tenants with incomplete
/// claim data).
/// </summary>
public class ZoneLookupService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IHttpContextAccessor httpContextAccessor)
    : BaseService(contextFactory)
{
    public async Task<List<RatingZoneDepotDto>> GetRatingZonesAsync()
    {
        var countryCode = httpContextAccessor.HttpContext?.User
            .FindFirstValue("CountryCode");
        var isUs = string.Equals(countryCode, "US", StringComparison.OrdinalIgnoreCase);
        Log.Information("ZoneLookupService.GetRatingZones: countryCode={CountryCode}, isUs={IsUs}",
            countryCode ?? "(null)", isUs);
        return isUs
            ? await GetUsRatingZonesAsync()
            : await GetNzRatingZonesAsync();
    }

    private async Task<List<RatingZoneDepotDto>> GetNzRatingZonesAsync()
    {
        // Load only depots that have at least one bound postcode - matches
        // Client Manager's "don't show empty depots" behaviour.
        var depots = await Context.TblBulkRegions
            .AsNoTracking()
            .Where(d => (d.Active ?? true))
            .Include(d => d.BulkZonePostcodes)
            .Include(d => d.BulkZonePostcodeGroups)
            .OrderBy(d => d.Name)
            .ToListAsync();

        var result = new List<RatingZoneDepotDto>();
        foreach (var d in depots)
        {
            if (d.BulkZonePostcodes.Count == 0) continue;

            // Group by (PostcodeGroupId, Zone). Ungrouped postcodes get
            // GroupId = null so the UI can render them under a "(no group)"
            // heading. Zero-pad NZ postcodes to 4 digits (spec sec. "NZ query
            // logic").
            var groups = d.BulkZonePostcodes
                .GroupBy(z => z.PostcodeGroupId)
                .OrderBy(g => g.Key ?? int.MaxValue)
                .Select(g =>
                {
                    var groupName = g.Key.HasValue
                        ? d.BulkZonePostcodeGroups.FirstOrDefault(gg => gg.Id == g.Key.Value)?.Name
                          ?? $"Group {g.Key.Value}"
                        : "(no group)";
                    var zones = g
                        .GroupBy(z => z.Zone)
                        .OrderBy(zg => zg.Key)
                        .Select(zg => new RatingZoneBucketDto(
                            zg.Key,
                            zg.Select(z => z.PostCode.ToString("D4"))
                              .Distinct()
                              .OrderBy(p => p, StringComparer.Ordinal)
                              .ToList()))
                        .ToList();
                    var postcodeCount = zones.Sum(z => z.Postcodes.Count);
                    return new RatingZoneGroupDto(g.Key, groupName, ZoneName: null, postcodeCount, zones);
                })
                .ToList();

            result.Add(new RatingZoneDepotDto(
                CountryCode: "NZ",
                DepotId: d.BulkRegionId,
                DepotName: d.Name ?? string.Empty,
                PostcodeCount: groups.Sum(g => g.PostcodeCount),
                Groups: groups));
        }
        return result;
    }

    private async Task<List<RatingZoneDepotDto>> GetUsRatingZonesAsync()
    {
        var depots = await Context.TblBulkRegions
            .AsNoTracking()
            .Where(d => (d.Active ?? true))
            .Include(d => d.ZoneNames)
                .ThenInclude(zn => zn.ZoneZips)
            .OrderBy(d => d.Name)
            .ToListAsync();

        var result = new List<RatingZoneDepotDto>();
        foreach (var d in depots)
        {
            // Flatten to (ZoneNameId, ZoneName1, ZoneZipGroupId, ZoneNumber, Zip).
            var flat = d.ZoneNames
                .SelectMany(zn => zn.ZoneZips.Select(zz => new
                {
                    ZoneName = zn.ZoneName1 ?? string.Empty,
                    ZoneZipGroupId = zz.ZoneZipGroupId,
                    ZoneNumber = zz.ZoneNumber ?? 0,
                    Zip = zz.Zip ?? string.Empty,
                }))
                .Where(x => !string.IsNullOrWhiteSpace(x.Zip))
                .ToList();
            if (flat.Count == 0) continue;

            // Group by (ZoneZipGroupId, ZoneName). US "group" identity here
            // is (group id + zone name) per spec sec. "Recommended grouping".
            var groups = flat
                .GroupBy(x => new { x.ZoneZipGroupId, x.ZoneName })
                .OrderBy(g => g.Key.ZoneZipGroupId ?? int.MaxValue)
                .ThenBy(g => g.Key.ZoneName, StringComparer.OrdinalIgnoreCase)
                .Select(g =>
                {
                    var zones = g
                        .GroupBy(x => x.ZoneNumber)
                        .OrderBy(zg => zg.Key)
                        .Select(zg => new RatingZoneBucketDto(
                            zg.Key,
                            zg.Select(x => x.Zip)
                              .Distinct(StringComparer.OrdinalIgnoreCase)
                              .OrderBy(z => z, StringComparer.Ordinal)
                              .ToList()))
                        .ToList();
                    var postcodeCount = zones.Sum(z => z.Postcodes.Count);
                    var groupName = g.Key.ZoneZipGroupId.HasValue
                        ? $"Group {g.Key.ZoneZipGroupId.Value}"
                        : "(no group)";
                    return new RatingZoneGroupDto(
                        GroupId: g.Key.ZoneZipGroupId,
                        GroupName: groupName,
                        ZoneName: g.Key.ZoneName,
                        PostcodeCount: postcodeCount,
                        Zones: zones);
                })
                .ToList();

            result.Add(new RatingZoneDepotDto(
                CountryCode: "US",
                DepotId: d.BulkRegionId,
                DepotName: d.Name ?? string.Empty,
                PostcodeCount: groups.Sum(g => g.PostcodeCount),
                Groups: groups));
        }
        return result;
    }
}
