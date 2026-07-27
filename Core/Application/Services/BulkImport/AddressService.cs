using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.BulkImport.Address;
using RoutedOperations.Core.Application.Services.Routing;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Models;
using Serilog;
using System.Globalization;

namespace RoutedOperations.Core.Application.Services.BulkImport;

// Ported from BulkImportHyper. Exposes the address lookups the Bulk Import
// wizard needs at Step 2 (Origin Location dropdown, historical geocoding for
// pre-existing addresses, coverage checks against ZipPolygon) and Step 5
// (postcode -> depot / zip -> location groupings).
//
// Adaptation vs source: the inline HERE and Google geocoders were replaced
// with a single call to the pre-existing HereGeocodeService (Routing folder).
// That service already owns the HERE API contract for RoutedOperations
// (typed HttpClient, timeout, error handling, JSON deserialisation) so we
// don't ship two parallel HERE clients. Google fallback was dropped because
// the RoutedOperations stack doesn't have the equivalent shared client yet.
// Historical DB lookup (against tblBulkJob rows) is retained verbatim because
// it's free, deterministic, and hits before any external API call.
public class AddressService(
    IDbContextFactory<DynamicDespatchDbContext> contextFactory,
    IHttpContextAccessor httpContextAccessor,
    HereGeocodeService hereGeocodeService,
    TenantScopedCache cache) : BaseService(contextFactory)
{
    private readonly IHttpContextAccessor _httpContextAccessor = httpContextAccessor;
    private readonly HereGeocodeService _hereGeocodeService = hereGeocodeService;
    private readonly TenantScopedCache _cache = cache;

    // 1-hour sliding TTL. Address reference tables (tucSuburb, ZoneZip,
    // tblBulkRegion, ZoneName) are edited via AdminManager (different app -
    // we cannot invalidate on write); 1h is a fine staleness ceiling for
    // per-session operator workflows.
    private static readonly TimeSpan RefDataTtl = TimeSpan.FromHours(1);

    internal const string TO_COMPANY_SEPERATOR = ", ";

    private string GetCountryCode()
    {
        return _httpContextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CountryCode")?.Value?.ToUpper();
    }

    private bool IsNzTenant()
    {
        var countryCode = GetCountryCode();
        var nz = Country.Nz.GetDescription();
        return countryCode?.Equals(nz) ?? false;
    }

    private bool IsUsTenant()
    {
        var countryCode = GetCountryCode();
        var usa = Country.Us.GetDescription();
        return countryCode?.Equals(usa) ?? false;
    }

    public Task<SuburbsResponse> GetSuburbs(Guid messageId) =>
        _cache.GetOrSetAsync("address:suburbs", RefDataTtl, () => LoadSuburbsAsync(messageId));

    private async Task<SuburbsResponse> LoadSuburbsAsync(Guid messageId)
    {
        // For US tenants, return empty suburbs list
        if (IsUsTenant())
        {
            return new SuburbsResponse(messageId)
            {
                Success = true,
                Suburbs = new List<SuburbDto>()
            };
        }

        return new SuburbsResponse(messageId)
        {
            Success = true,
            Suburbs = await Context.TucSuburbs
                .AsNoTracking()
                .Select(s => new SuburbDto()
                {
                    Id = s.UcsuId,
                    Name = s.UcsuName,
                    City = s.City.Trim().Length > 0 ? s.City.Trim() : null,
                    PostCode = s.PostCode.Trim().Length > 0 ? s.PostCode.Trim().PadLeft(4, '0') : null,
                    Alias = s.Alias.Trim().Length > 0 && s.Alias.Trim() != "," ? s.Alias.Trim() : null,
                    GoogleAlias = s.GoogleSuburbAlias.Trim().Length > 0 ? s.GoogleSuburbAlias.Trim() : null
                })
                .OrderBy(s => s.Name)
                .ToListAsync()
        };
    }

    public Task<ZipCodesResponse> GetZipCodes(Guid messageId) =>
        _cache.GetOrSetAsync("address:zipcodes", RefDataTtl, () => LoadZipCodesAsync(messageId));

    private async Task<ZipCodesResponse> LoadZipCodesAsync(Guid messageId)
    {
        // For NZ tenants, return empty zip codes list
        if (IsNzTenant())
        {
            return new ZipCodesResponse(messageId)
            {
                Success = true,
                ZipCodes = new List<ZipCodeDto>()
            };
        }

        return new ZipCodesResponse(messageId)
        {
            Success = true,
            ZipCodes = await Context.ZoneZips
                .AsNoTracking()
                .Select(s => new ZipCodeDto()
                {
                    Id = s.ZoneZipId,
                    ZoneNumber = s.ZoneNumber,
                    ZoneName = s.ZoneName.ZoneName1,
                    Zip = s.Zip,
                    ClientId = s.ClientId,
                    ApplyCongestion = s.ApplyCongestion
                })
                .OrderBy(s => s.ZoneNumber)
                .ToListAsync()
        };
    }

    // Active regions for the Step 2 "Origin Location" dropdown. tblBulkRegion
    // has no ClientId column (regions are global per-tenant DB), so we just
    // filter on Active. The dynamic DB context already scopes to the tenant.
    // US tenant: a region is the "site" / "depot" that owns a routed schedule.
    // NZ tenant: same shape - the endpoint works but the Step 2 UI hides the
    // dropdown so it goes unused.
    public async Task<RegionsResponse> GetRegions(Guid messageId)
    {
        return new RegionsResponse(messageId)
        {
            Success = true,
            Regions = await Context.TblBulkRegions
                .AsNoTracking()
                .Where(r => r.Active == true)
                .OrderBy(r => r.Name)
                .Select(r => new RegionDto()
                {
                    Id = r.BulkRegionId,
                    Name = r.Name,
                    FromCompany = r.FromCompany,
                    FromAddress = r.FromAddress,
                    // AddressLine5/6/7 are US city/state/zip; harmless for NZ
                    FromCity = r.AddressLine5,
                    FromState = r.AddressLine6,
                    FromZipCode = r.AddressLine7
                })
                .ToListAsync()
        };
    }

    // Canonical coverage list. dbo.ZipPolygon is the broad "is this
    // destination valid / covered at all?" source. Step 5 grouping uses
    // this to bucket jobs that are valid but not yet assigned to a
    // location/depot into the "Valid ZIP - Rate By Distance" bucket
    // instead of "Unmatched Zip". For NZ tenants the table is currently
    // empty so this just returns []; the same code path activates once
    // NZ data is populated.
    public async Task<ZipPolygonsResponse> GetZipPolygons(Guid messageId)
    {
        return new ZipPolygonsResponse(messageId)
        {
            Success = true,
            Zips = await Context.ZipPolygons
                .AsNoTracking()
                .Where(z => z.Zip != null && z.Zip != "")
                .Select(z => z.Zip)
                .Distinct()
                .ToListAsync()
        };
    }

    public async Task<GeocodeResponse> Geocode(GeocodeRequest request)
    {
        GeocodeResponse response = new GeocodeResponse(request.MessageId);

        // US tenants identify rows by City/State/ZipCode (PickupAddressLine5/6/7,
        // DeliveryAddressLine5/6/7). NZ tenants identify rows by Suburb/PostCode.
        bool isUs = IsUsTenant();

        // IMPORTANT: the frontend (FixAddressesModal) indexes response.Addresses[i]
        // against request.Addresses[i] as the SAME parsed-file row. Every code
        // path below MUST produce exactly one output entry per input entry, in
        // the SAME order, or the operator ends up pinning coords onto the wrong
        // row. Earlier revisions filtered + .Distinct()'d the input which
        // silently shifted every downstream index.
        //
        // `addressesToGeocode` (the DEDUPED workable set) is used ONLY for the
        // DB-cache batch lookup below. Row-by-row output is assembled in
        // `perRowResults` at the end using an index -> geocoded dto map.
        var addressesToGeocode = request.Addresses
            .Where(a => !string.IsNullOrWhiteSpace(a.Address)
                        && (isUs
                            ? (!string.IsNullOrWhiteSpace(a.City) || !string.IsNullOrWhiteSpace(a.ZipCode))
                            : !string.IsNullOrWhiteSpace(a.Suburb)))
            .Distinct()
            .ToList();

        Log.Information($"({request.MessageId}) Database geocoding {addressesToGeocode.Count()} addresses.");

        // Result-by-input-ref map. Populated by both the DB-cache pass and the
        // HERE fallback, then read once in the final index-preserving output
        // assembly at the bottom of this method. Keyed by REFERENCE so two
        // rows that happen to have identical content (common: hub returns
        // with same delivery address) both look up independently.
        var perInputRef = new Dictionary<AddressDto, GeocodeAddressDto>(ReferenceEqualityComparer.Instance);
        List<GeocodeAddressDto> geocodedAddresses = new List<GeocodeAddressDto>();
        List<AddressDto> missingAddresses = new List<AddressDto>();

        if (isUs)
        {
            var cities = addressesToGeocode
                .Where(a => !string.IsNullOrWhiteSpace(a.City))
                .Select(a => a.City.Trim().ToLower())
                .Distinct()
                .ToList();

            var zips = addressesToGeocode
                .Where(a => !string.IsNullOrWhiteSpace(a.ZipCode))
                .Select(a => a.ZipCode.Trim().ToLower())
                .Distinct()
                .ToList();

            var addresses = await Context.TblBulkJobs
                    .OrderByDescending(j => j.BookDate)
                    .Select(j => new GeocodeAddressDto()
                    {
                        Address = j.FromAddress,
                        City = j.PickupAddressLine5,
                        State = j.PickupAddressLine6,
                        ZipCode = j.PickupAddressLine7,
                        Latitude = j.PickUpLatitude,
                        Longitude = j.PickUpLongitude,
                        GeoType = j.FromGeoType
                    })
                    .Union(Context.TblBulkJobs
                        .OrderByDescending(j => j.BookDate)
                        .Select(j => new GeocodeAddressDto()
                        {
                            Address = j.ToAddress.StartsWith(j.ToCompany + TO_COMPANY_SEPERATOR)
                                    ? j.ToAddress.Substring((j.ToCompany + TO_COMPANY_SEPERATOR).Length, j.ToAddress.Length - (j.ToCompany + TO_COMPANY_SEPERATOR).Length)
                                    : j.ToAddress,
                            City = j.DeliveryAddressLine5,
                            State = j.DeliveryAddressLine6,
                            ZipCode = j.DeliveryAddressLine7,
                            Latitude = j.DeliveryLatitude,
                            Longitude = j.DeliveryLongitude,
                            GeoType = j.ToGeoType
                        }))
                    .Where(a => a.Address != null && a.Address.Trim().Length > 0
                                && a.Latitude != null && a.Latitude.Trim().Length > 0
                                && a.Longitude != null && a.Longitude.Trim().Length > 0
                                && ((a.City != null && cities.Contains(a.City.Trim().ToLower()))
                                    || (a.ZipCode != null && zips.Contains(a.ZipCode.Trim().ToLower()))))
                    .Distinct()
                    .ToListAsync();

            foreach (var a in addressesToGeocode)
            {
                var addr = a.Address?.Trim().ToLower();
                var city = a.City?.Trim().ToLower();
                var zip = a.ZipCode?.Trim().ToLower();

                // Best match: address + city + zip. Fallbacks: address + zip, address + city.
                var found = addresses.FirstOrDefault(x => x.Address.Trim().ToLower() == addr
                                                          && x.City != null && x.City.Trim().ToLower() == city
                                                          && x.ZipCode != null && x.ZipCode.Trim().ToLower() == zip)
                            ?? addresses.FirstOrDefault(x => x.Address.Trim().ToLower() == addr
                                                          && x.ZipCode != null && x.ZipCode.Trim().ToLower() == zip)
                            ?? addresses.FirstOrDefault(x => x.Address.Trim().ToLower() == addr
                                                          && x.City != null && x.City.Trim().ToLower() == city);

                if (found != null)
                {
                    var suggestedZip = string.IsNullOrWhiteSpace(found.ZipCode) ? null : found.ZipCode.Trim();
                    var dto = new GeocodeAddressDto()
                    {
                        Address = a.Address,
                        City = a.City,
                        State = a.State,
                        ZipCode = a.ZipCode,
                        Latitude = found.Latitude,
                        Longitude = found.Longitude,
                        GeoType = found.GeoType,
                        SuggestedZipCode = suggestedZip != null && !string.Equals(suggestedZip, a.ZipCode?.Trim(), StringComparison.OrdinalIgnoreCase) ? suggestedZip : null
                    };
                    geocodedAddresses.Add(dto);
                    perInputRef[a] = dto;
                }
                else
                    missingAddresses.Add(a);
            }
        }
        else
        {
            var suburbs = addressesToGeocode
                .Select(a => a.Suburb.Trim().ToLower())
                .Distinct()
                .ToList();

            var addresses = await Context.TblBulkJobs
                    .OrderByDescending(j => j.BookDate)
                    .Select(j => new GeocodeAddressDto()
                    {
                        Address = j.FromAddress,
                        Suburb = j.FromSuburb,
                        PostCode = j.FromPostCode.ToString(),
                        Latitude = j.PickUpLatitude,
                        Longitude = j.PickUpLongitude,
                        GeoType = j.FromGeoType
                    })
                    .Union(Context.TblBulkJobs
                        .OrderByDescending(j => j.BookDate)
                        .Select(j => new GeocodeAddressDto()
                        {
                            Address = j.ToAddress.StartsWith(j.ToCompany + TO_COMPANY_SEPERATOR)
                                    ? j.ToAddress.Substring((j.ToCompany + TO_COMPANY_SEPERATOR).Length, j.ToAddress.Length - (j.ToCompany + TO_COMPANY_SEPERATOR).Length)
                                    : j.ToAddress,
                            Suburb = j.ToSuburb,
                            PostCode = j.ToPostCode.ToString(),
                            Latitude = j.DeliveryLatitude,
                            Longitude = j.DeliveryLongitude,
                            GeoType = j.ToGeoType
                        }))
                    .Where(a => a.Address.Trim().Length > 0 && a.Suburb.Trim().Length > 0 && a.PostCode.Trim().Length > 0 && a.Latitude.Trim().Length > 0 && a.Longitude.Trim().Length > 0 && suburbs.Contains(a.Suburb.Trim().ToLower()))
                    .Distinct()
                    .ToListAsync();

            var groupedAddresses = addresses
                .GroupBy(a => a.Suburb.Trim().ToLower())
                .ToList();

            foreach (var a in addressesToGeocode)
            {
                var group = groupedAddresses.FirstOrDefault(x => x.Key == a.Suburb.Trim().ToLower());
                var found = group?.FirstOrDefault(x => x.Address.Trim().ToLower() == a.Address.Trim().ToLower() && x.PostCode?.Trim().PadLeft(4, '0') == a.PostCode?.Trim().PadLeft(4, '0'))
                            ?? group?.FirstOrDefault(x => x.Address.Trim().ToLower() == a.Address.Trim().ToLower());

                if (found != null)
                {
                    var suggestedPostCode = AddressUtility.FormatPostCode(found.PostCode);
                    var dto = new GeocodeAddressDto()
                    {
                        Address = a.Address,
                        Suburb = a.Suburb,
                        PostCode = a.PostCode,
                        Latitude = found.Latitude,
                        Longitude = found.Longitude,
                        GeoType = found.GeoType,
                        SuggestedPostCode = suggestedPostCode != null && suggestedPostCode != AddressUtility.FormatPostCode(a.PostCode) ? suggestedPostCode : null
                    };
                    geocodedAddresses.Add(dto);
                    perInputRef[a] = dto;
                }
                else
                    missingAddresses.Add(a);
            }
        }

        Log.Information($"({request.MessageId}) Database has geocoded {geocodedAddresses.Count()} addresses.");

        // Anything still missing goes through the shared HERE geocoder. The
        // helper populates perInputRef with the HERE results keyed by the
        // SAME input reference we passed in, so the final output-assembly
        // step below stays index-aligned with request.Addresses.
        await GeocodeViaHereInto(request.MessageId, missingAddresses, isUs, perInputRef);

        // Produce EXACTLY ONE output entry per input entry, in the SAME order
        // as request.Addresses. Blanks and misses become null-coord placeholders
        // so FixAddressesModal flags them for operator pin-correction rather
        // than silently dropping rows (which would misalign every downstream
        // fixedAddresses[i] index).
        var perRow = new List<GeocodeAddressDto>(request.Addresses.Count());
        foreach (var input in request.Addresses)
        {
            if (input != null && perInputRef.TryGetValue(input, out var hit))
            {
                perRow.Add(hit);
            }
            else
            {
                perRow.Add(new GeocodeAddressDto
                {
                    Address = input?.Address,
                    City = input?.City,
                    State = input?.State,
                    ZipCode = input?.ZipCode,
                    Suburb = input?.Suburb,
                    PostCode = input?.PostCode,
                    Latitude = null,
                    Longitude = null,
                    GeoType = 0,
                });
            }
        }

        response.Addresses = perRow;
        response.Success = true;
        return response;
    }

    // Route the "still-missing" addresses through the shared HereGeocodeService.
    // Populates `perInputRef` keyed by the same AddressDto reference the
    // caller passed in, so the final output-assembly loop in Geocode() can
    // stay index-aligned with request.Addresses.
    //
    // Every input row MUST emit exactly one entry in perInputRef (either a
    // hit with lat/lng or a placeholder with null coords). Silent skips
    // (blank query, HERE exception, HERE no-match) all get a null-coord
    // placeholder so FixAddressesModal flags them for pin-correction.
    private async Task GeocodeViaHereInto(Guid messageId, IEnumerable<AddressDto> addresses, bool isUs, Dictionary<AddressDto, GeocodeAddressDto> perInputRef)
    {
        if (addresses == null || !addresses.Any())
            return;

        Log.Information($"({messageId}) HERE geocoding {addresses.Count()} addresses.");

        var countryHint = isUs ? "USA" : "NZL";

        // Suburb alias lookup for NZ - lets the caller-supplied suburb (which
        // may be a local variant) map to the canonical Google/HERE label
        // before we build the query string. Mirrors the source verbatim.
        var suburbAlias = isUs
            ? new Dictionary<string, (string Alias, string PostCode)>()
            : (await Context.TucSuburbs
                .Where(s => s.GoogleSuburbAlias.Trim().Length > 0)
                .Select(s => new { s.UcsuName, s.PostCode, s.GoogleSuburbAlias })
                .ToListAsync())
                .GroupBy(s => (s.UcsuName ?? string.Empty).Trim().ToLower())
                .ToDictionary(g => g.Key, g => (Alias: g.First().GoogleSuburbAlias.Trim(), PostCode: g.First().PostCode));

        int hitCount = 0;
        foreach (var address in addresses)
        {
            // Every branch below writes exactly one entry into perInputRef so
            // the caller's output-assembly loop stays index-aligned. Skipping
            // silently (blank query / exception / no-match) would shift every
            // downstream row - see the top-of-Geocode() contract comment.
            GeocodeAddressDto dto;
            try
            {
                // Compose a single free-text query the shared geocoder handles.
                string query;
                if (isUs)
                {
                    var parts = new[] { address.Address?.Trim(), address.City?.Trim(), address.State?.Trim(), address.ZipCode?.Trim() }
                        .Where(p => !string.IsNullOrWhiteSpace(p));
                    query = string.Join(", ", parts);
                }
                else
                {
                    var suburbName = address.Suburb?.Trim();
                    if (!string.IsNullOrWhiteSpace(suburbName)
                        && suburbAlias.TryGetValue(suburbName.ToLower(), out var alias)
                        && !string.IsNullOrWhiteSpace(alias.Alias))
                    {
                        suburbName = alias.Alias;
                    }
                    var postCode = AddressUtility.FormatPostCode(address.PostCode);
                    var parts = new[] { address.Address?.Trim(), suburbName, postCode }
                        .Where(p => !string.IsNullOrWhiteSpace(p));
                    query = string.Join(", ", parts);
                }

                if (string.IsNullOrWhiteSpace(query))
                {
                    perInputRef[address] = MakeUnresolvedDto(address);
                    continue;
                }

                var result = await _hereGeocodeService.GeocodeAsync(query, countryHint);
                if (result == null)
                {
                    Log.Warning($"({messageId}) HERE geocoder returned no match for '{query}'");
                    perInputRef[address] = MakeUnresolvedDto(address);
                    continue;
                }

                dto = new GeocodeAddressDto()
                {
                    Address = address.Address,
                    // 2 = HERE "interpolated" equivalent - the shared client
                    // doesn't currently surface the ResultType metadata the
                    // source used to distinguish 1 / 2 / 3.
                    GeoType = 2,
                    Latitude = result.Lat.ToString(CultureInfo.InvariantCulture),
                    Longitude = result.Lng.ToString(CultureInfo.InvariantCulture)
                };

                if (isUs)
                {
                    dto.City = address.City;
                    dto.State = address.State;
                    dto.ZipCode = address.ZipCode;
                    var heresZip = result.PostCode?.Trim();
                    dto.SuggestedZipCode = !string.IsNullOrWhiteSpace(heresZip)
                                            && !string.Equals(heresZip, address.ZipCode?.Trim(), StringComparison.OrdinalIgnoreCase)
                                          ? heresZip : null;
                }
                else
                {
                    dto.Suburb = address.Suburb;
                    dto.PostCode = address.PostCode;
                    var suggestedPostCode = AddressUtility.FormatPostCode(result.PostCode);
                    dto.SuggestedPostCode = suggestedPostCode != null && suggestedPostCode != AddressUtility.FormatPostCode(address.PostCode)
                        ? suggestedPostCode
                        : null;
                }
            }
            catch (Exception ex)
            {
                Log.Warning($"({messageId}) HERE geocode threw for {address.Address}, {address.Suburb ?? address.City}: {ex.Message}");
                perInputRef[address] = MakeUnresolvedDto(address);
                continue;
            }

            perInputRef[address] = dto;
            hitCount++;
        }

        Log.Information($"({messageId}) HERE has geocoded {hitCount} addresses.");
    }

    // Null-coord placeholder used whenever a HERE geocode was attempted but
    // yielded nothing (blank query, no-match, or exception). Emitting the
    // placeholder into perInputRef keeps the final output list index-aligned
    // with request.Addresses; FixAddressesModal then flags the row for pin
    // correction.
    private static GeocodeAddressDto MakeUnresolvedDto(AddressDto address) =>
        new GeocodeAddressDto
        {
            Address = address.Address,
            City = address.City,
            State = address.State,
            ZipCode = address.ZipCode,
            Suburb = address.Suburb,
            PostCode = address.PostCode,
            GeoType = 0,
            Latitude = null,
            Longitude = null,
        };

    public async Task<SortPostcodesByRegionResponse> GetPostcodesByDepotAsync(Guid messageId)
    {
        var response = new SortPostcodesByRegionResponse(messageId);

        // For US tenants, return empty depots list
        if (!IsNzTenant())
        {
            response.Success = true;
            response.Depots = new List<RegionPostcodesDto>();
            return response;
        }

        // Use defaults for now and ignore groupings
        var postcodeDepots = await Context.BulkZonePostcodes
            .Where(p => !p.PostcodeGroupId.HasValue && p.DepotId.HasValue)
            .Select(p => new {
                p.PostCode,
                p.DepotId,
                p.Depot.Name
            })
            .ToListAsync();

        response.Depots = postcodeDepots
            .GroupBy(p => new { p.DepotId, p.Name })
            .Select(x => new RegionPostcodesDto()
            {
                Id = x.Key.DepotId.Value,
                Name = x.Key.Name,
                Postcodes = x
                    .Select(p => p.PostCode.ToString().PadLeft(4, '0'))
                    .ToList()
            })
            .ToList();

        response.Success = true;
        return response;
    }

    public async Task<SortZipCodesByLocationResponse> GetZipCodesByLocationAsync(Guid messageId)
    {
        var response = new SortZipCodesByLocationResponse(messageId);

        var zipCodeLocations = await Context.ZoneZips
            .Where(p => p.ZoneName.LocationId.HasValue)
            .Select(p => new {
                p.Zip,
                p.ZoneName.LocationId,
                p.ZoneName.Location.Name
            })
            .ToListAsync();

        response.Locations = zipCodeLocations
            .GroupBy(p => new { p.LocationId, p.Name })
            .Select(x => new LocationZipcodesDto()
            {
                Id = x.Key.LocationId.Value,
                Name = x.Key.Name,
                ZipCodes = x
                    .Select(p => p.Zip)
                    .ToList()
            })
            .ToList();

        response.Success = true;
        return response;
    }

    public async Task<SortPostcodesByRegionResponse> SortPostcodesByRegionAsync(SortPostcodesByRegionRequest request)
    {
        var response = new SortPostcodesByRegionResponse(request.MessageId);

        // This endpoint is NZ-specific
        if (!IsNzTenant())
        {
            response.Success = false;
            response.Messages = new List<Dtos.BulkImport.Common.MessageDto>
            {
                new Dtos.BulkImport.Common.MessageDto { Message = "This endpoint is only available for NZ tenants" }
            };
            return response;
        }

        if (request.Postcodes.Any(p => string.IsNullOrWhiteSpace(p) || !int.TryParse(p.Trim(), out int result)))
            return BulkImportResponseUtility.AddMessageAndReturnResponse(response, "Invalid postcode.");

        var postcodesFormatted = request.Postcodes
            .Select(p => int.Parse(p.Trim()))
            .Distinct()
            .ToList();

        // Use defaults for now and ignore groupings
        var postcodeRegions = await Context.BulkZonePostcodes
            .Where(p => !p.PostcodeGroupId.HasValue && postcodesFormatted.Contains(p.PostCode))
            .Select(p => new
            {
                p.PostCode,
                p.DepotId,
                p.Depot.Name
            })
            .ToListAsync();

        response.Depots = postcodesFormatted
            .GroupBy(p => postcodeRegions
                .Where(x => x.PostCode == p)
                .Select(x => new { DepotId = x.DepotId ?? 0, Name = x.Name ?? "Unassigned" })
                .FirstOrDefault()
                ??
                new { DepotId = 0, Name = "Unassigned" })
            .Select(x => new RegionPostcodesDto()
            {
                Id = x.Key.DepotId,
                Name = x.Key.Name,
                Postcodes = x
                    .Select(p => p.ToString().PadLeft(4, '0'))
                    .ToList()
            })
            .OrderBy(X => X.Name)
            .ToList();

        response.Success = true;
        return response;
    }
}
