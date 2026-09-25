using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using RoutedOperations.Infrastructure;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Routing;

/// <summary>
/// Server-side proxy for HERE Maps Geocoding API v7 (geocode.search.hereapi.com).
/// Sibling to HereMapService (routing / findsequence2). Kept separate because
/// the two endpoints have different rate limits + failure modes, and the geocode
/// path is only used by the Bulk Import promote flow today.
///
/// Input: free-text address. Output: {lat, lng, postCode, suburb, formatted}.
/// Returns null on any failure (network, no match, malformed response) so
/// callers can treat "no geocode" as a soft failure to be flagged per-row,
/// not a hard exception that aborts the batch.
///
/// Regional bias via CountryCode (ISO 3166-1 alpha-3, e.g. "USA", "NZL"). HERE
/// treats it as a soft hint; the top result is still ranked by relevance.
/// </summary>
public class HereGeocodeService(HttpClient httpClient, AppSettings appSettings)
{
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
        PropertyNameCaseInsensitive = true,
    };

    public async Task<HereGeocodeResult?> GeocodeAsync(string address, string? countryCode = null)
    {
        if (string.IsNullOrWhiteSpace(address)) return null;
        if (string.IsNullOrEmpty(appSettings.HereMapsApiKey))
        {
            Log.Warning("HereMapsApiKey not configured - geocode disabled");
            return null;
        }

        var q = Uri.EscapeDataString(address.Trim());
        // "in=countryCode:USA,NZL" is HERE's ISO-3166-1 alpha-3 country
        // narrowing. Pass through only when the caller has a specific bias -
        // omitting it lets HERE guess from the address text itself.
        var country = string.IsNullOrWhiteSpace(countryCode)
            ? ""
            : $"&in=countryCode:{Uri.EscapeDataString(countryCode.Trim())}";
        var url = $"https://geocode.search.hereapi.com/v1/geocode?q={q}{country}&limit=1&apiKey={appSettings.HereMapsApiKey}";

        try
        {
            var response = await httpClient.GetAsync(url);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                Log.Warning("HERE geocode failed for '{Address}': {Status} {Body}",
                    address, response.StatusCode, body);
                return null;
            }

            var raw = await response.Content.ReadFromJsonAsync<HereGeocodeRawResponse>(_jsonOptions);
            var top = raw?.Items?.FirstOrDefault();
            if (top?.Position == null)
            {
                Log.Information("HERE geocode returned no results for '{Address}'", address);
                return null;
            }

            return new HereGeocodeResult
            {
                Lat = top.Position.Lat,
                Lng = top.Position.Lng,
                FormattedAddress = top.Address?.Label,
                Suburb = top.Address?.District ?? top.Address?.City,
                PostCode = top.Address?.PostalCode,
                CountryCode = top.Address?.CountryCode,
            };
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "HERE geocode threw for '{Address}'", address);
            return null;
        }
    }

    /// <summary>
    /// Reverse geocode a lat/lng to {formatted, postCode, suburb}. Used by the
    /// Fix GPS modal when the operator drags the pin or right-clicks the map
    /// so we can populate the postcode field without a Google Geocoder call.
    /// Returns null on any failure so callers can fall back to raw coords.
    ///
    /// countryCode is accepted for API symmetry with forward geocode but is
    /// intentionally ignored here: HERE's `in=countryCode:` filter narrows so
    /// aggressively that a coord clearly inside the requested country can
    /// return zero results if the nearest street segment straddles a locale
    /// boundary. The lat/lng already implies the country, so we let HERE pick
    /// the natural match and cross-check afterwards if needed.
    /// </summary>
    public async Task<HereGeocodeResult?> ReverseGeocodeAsync(double lat, double lng, string? countryCode = null)
    {
        _ = countryCode; // parameter reserved for future use, see summary
        if (string.IsNullOrEmpty(appSettings.HereMapsApiKey))
        {
            Log.Warning("HereMapsApiKey not configured - reverse geocode disabled");
            return null;
        }

        var at = $"{lat.ToString("0.######", CultureInfo.InvariantCulture)}," +
                 $"{lng.ToString("0.######", CultureInfo.InvariantCulture)}";
        var url = $"https://revgeocode.search.hereapi.com/v1/revgeocode?at={at}&limit=1&apiKey={appSettings.HereMapsApiKey}";

        try
        {
            var response = await httpClient.GetAsync(url);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                Log.Warning("HERE reverse geocode failed for ({Lat},{Lng}): {Status} {Body}",
                    lat, lng, response.StatusCode, body);
                return null;
            }

            var raw = await response.Content.ReadFromJsonAsync<HereGeocodeRawResponse>(_jsonOptions);
            var top = raw?.Items?.FirstOrDefault();
            if (top?.Position == null)
            {
                Log.Information("HERE reverse geocode returned no results for ({Lat},{Lng})", lat, lng);
                return null;
            }

            return new HereGeocodeResult
            {
                Lat = top.Position.Lat,
                Lng = top.Position.Lng,
                FormattedAddress = top.Address?.Label,
                Suburb = top.Address?.District ?? top.Address?.City,
                PostCode = top.Address?.PostalCode,
                CountryCode = top.Address?.CountryCode,
            };
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "HERE reverse geocode threw for ({Lat},{Lng})", lat, lng);
            return null;
        }
    }

    // -- HERE response shape (subset we consume) ---------------------------
    private sealed class HereGeocodeRawResponse
    {
        public List<HereGeocodeItem>? Items { get; set; }
    }
    private sealed class HereGeocodeItem
    {
        public HereGeocodePosition? Position { get; set; }
        public HereGeocodeAddress? Address { get; set; }
    }
    private sealed class HereGeocodePosition
    {
        public double Lat { get; set; }
        public double Lng { get; set; }
    }
    private sealed class HereGeocodeAddress
    {
        public string? Label { get; set; }
        public string? City { get; set; }
        public string? District { get; set; }
        public string? PostalCode { get; set; }
        public string? CountryCode { get; set; }
    }
}

public sealed class HereGeocodeResult
{
    public double Lat { get; set; }
    public double Lng { get; set; }
    public string? FormattedAddress { get; set; }
    public string? Suburb { get; set; }
    public string? PostCode { get; set; }
    public string? CountryCode { get; set; }

    /// <summary>
    /// Convenience: post code stripped to digits and parsed as int. Handles
    /// US ZIP+4 by taking the head only. Returns null when nothing parses.
    /// </summary>
    public int? PostCodeInt
    {
        get
        {
            if (string.IsNullOrWhiteSpace(PostCode)) return null;
            var head = PostCode.Split('-', 2)[0];
            var digits = new string(head.Where(char.IsDigit).ToArray());
            return int.TryParse(digits, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)
                ? n : null;
        }
    }
}
