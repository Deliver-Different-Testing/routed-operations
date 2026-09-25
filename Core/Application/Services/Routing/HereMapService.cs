using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using RoutedOperations.Core.Application.Dtos.Route;
using RoutedOperations.Infrastructure;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Routing;

/// <summary>
/// Server-side proxy for HERE Maps `findsequence2`. Two variants:
///  * <see cref="SequenceAsync"/> - legacy pass-through: caller supplies a
///    pre-built query string, raw JSON is returned. Kept for the legacy
///    /api/routes/here-sequence endpoint.
///  * <see cref="SequenceTypedAsync"/> - the frontend supplies typed waypoints,
///    the server builds the query string + adds the API key, and the response
///    is parsed into an ordered-names + total-minutes + per-leg-minutes
///    projection. Used by the Delivery Window build flow so we can populate
///    real leg times into the split logic.
/// </summary>
public class HereMapService(HttpClient httpClient, AppSettings appSettings)
{
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public async Task<object?> SequenceAsync(HereMapSequenceRequest data)
    {
        EnsureConfigured();
        var url = $"https://wps.hereapi.com/v8/findsequence2?apiKey={appSettings.HereMapsApiKey}{data.RequestData}";
        var response = await httpClient.GetAsync(url);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            Log.Error("HERE findsequence2 failed: {Status} {Body}", response.StatusCode, body);
            return null;
        }

        return await response.Content.ReadFromJsonAsync<object>(_jsonOptions);
    }

    public async Task<HereSequenceResult?> SequenceTypedAsync(HereSequenceRequestTyped request)
    {
        EnsureConfigured();
        if (request.Destinations.Count == 0)
        {
            Log.Warning("SequenceTypedAsync called with no destinations");
            return new HereSequenceResult { TotalMinutes = 0 };
        }

        // Build the HERE query in the format legacy RunBuilder used:
        //   start=<name>;<lat>,<lng>&destination0=...&...&end=<name>;<lat>,<lng>&mode=<mode>
        // Two new optional pins (Plan §Phase 2 §6.2/6.3):
        //   ReturnToStart -> append `end=<Start>` so HERE routes back to origin.
        //   FinishAtName  -> pull the matching destination out of the middle
        //                    and pin it as `end` so HERE keeps it last.
        var parts = new List<string>
        {
            $"start={FormatWaypoint(request.Start)}",
        };
        var middleDestinations = request.Destinations.ToList();
        HereSequenceStop? fixedEnd = null;
        if (!string.IsNullOrWhiteSpace(request.FinishAtName))
        {
            var pinned = middleDestinations.FirstOrDefault(d => d.Name == request.FinishAtName);
            if (pinned != null)
            {
                fixedEnd = pinned;
                middleDestinations.Remove(pinned);
            }
        }
        for (var i = 0; i < middleDestinations.Count; i++)
        {
            parts.Add($"destination{i}={FormatWaypoint(middleDestinations[i])}");
        }
        if (fixedEnd != null)
        {
            parts.Add($"end={FormatWaypoint(fixedEnd)}");
        }
        else if (request.ReturnToStart)
        {
            parts.Add($"end={FormatWaypoint(request.Start)}");
        }
        parts.Add($"mode={Uri.EscapeDataString(request.Mode)}");

        var url = $"https://wps.hereapi.com/v8/findsequence2?apiKey={appSettings.HereMapsApiKey}&{string.Join('&', parts)}";
        var response = await httpClient.GetAsync(url);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            Log.Error("HERE findsequence2 (typed) failed: {Status} {Body}", response.StatusCode, body);
            return null;
        }

        var raw = await response.Content.ReadFromJsonAsync<HereRawResponse>(_jsonOptions);
        var results = raw?.results;
        if (results == null || results.Count == 0)
        {
            Log.Warning("HERE findsequence2 (typed) returned no results");
            return null;
        }

        var first = results[0];
        var waypoints = first.waypoints ?? new List<HereRawWaypoint>();
        var interconnections = first.interconnections ?? new List<HereRawInterconnection>();
        var totalMinutes = (double.TryParse(first.time, NumberStyles.Any, CultureInfo.InvariantCulture, out var tSec) ? tSec : 0) / 60.0;

        // Map waypoint id -> name for the exact shape we sent HERE.
        // destination{i} indices are middleDestinations (finish-at pin removed).
        // `end` is either the fixed-end pin, or the Start when returnToStart is set.
        var idToName = new Dictionary<string, string>(waypoints.Count)
        {
            ["start"] = request.Start.Name,
        };
        for (var i = 0; i < middleDestinations.Count; i++)
            idToName[$"destination{i}"] = middleDestinations[i].Name;
        if (fixedEnd != null)
            idToName["end"] = fixedEnd.Name;
        else if (request.ReturnToStart)
            idToName["end"] = request.Start.Name;

        // Order the waypoints by sequence (start has sequence 0).
        var ordered = waypoints.OrderBy(w => w.sequence).ToList();

        var orderedIds = ordered.Select(w => w.id ?? string.Empty).ToList();
        var orderedNames = orderedIds.Select(id => idToName.TryGetValue(id, out var n) ? n : id).ToList();

        // Per-hop minutes: match each (fromWaypoint, toWaypoint) leg to the
        // interconnection row. Same length as orderedNames; first entry = 0.
        var legMinutes = new List<double> { 0 };
        for (var i = 1; i < orderedIds.Count; i++)
        {
            var from = orderedIds[i - 1];
            var to = orderedIds[i];
            var leg = interconnections.FirstOrDefault(x => x.fromWaypoint == from && x.toWaypoint == to);
            legMinutes.Add(leg != null ? leg.time / 60.0 : 0);
        }

        return new HereSequenceResult
        {
            OrderedWaypointIds = orderedIds,
            OrderedNames = orderedNames,
            TotalMinutes = totalMinutes,
            LegMinutes = legMinutes,
        };
    }

    /// <summary>
    /// HERE Routing v8 polyline draw. Takes an ordered list of stops (already
    /// sequenced by the operator or a prior optimiser) and returns the driving
    /// polyline as a decoded list of lat/lng points. Used to replace the
    /// Google Directions polyline draw on the cockpit map without exposing
    /// the HERE key to the browser.
    ///
    /// HERE v8 accepts up to 100 waypoints per request. We chunk at 90 to
    /// leave headroom and stitch results end-to-end - each chunk overlaps the
    /// previous chunk's terminal stop so the polyline stays contiguous.
    /// </summary>
    public async Task<List<LatLngDto>?> RoutePolylineAsync(List<HereSequenceStop> stops)
    {
        EnsureConfigured();
        if (stops == null || stops.Count < 2)
        {
            Log.Warning("RoutePolylineAsync called with < 2 stops");
            return null;
        }

        const int ChunkMaxStops = 90;
        var points = new List<LatLngDto>();

        for (var cursor = 0; cursor < stops.Count - 1; cursor += ChunkMaxStops - 1)
        {
            var chunkEnd = Math.Min(cursor + ChunkMaxStops - 1, stops.Count - 1);
            var origin = stops[cursor];
            var destination = stops[chunkEnd];
            var vias = new List<HereSequenceStop>();
            for (var i = cursor + 1; i < chunkEnd; i++) vias.Add(stops[i]);

            var parts = new List<string>
            {
                $"transportMode=car",
                $"origin={FormatLatLng(origin)}",
                $"destination={FormatLatLng(destination)}",
                $"return=polyline",
            };
            foreach (var v in vias) parts.Add($"via={FormatLatLng(v)}");

            var url = $"https://router.hereapi.com/v8/routes?apiKey={appSettings.HereMapsApiKey}&{string.Join('&', parts)}";
            var response = await httpClient.GetAsync(url);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                Log.Warning("HERE Routing v8 polyline failed (chunk {Cursor}-{End}): {Status} {Body}",
                    cursor, chunkEnd, response.StatusCode, body);
                return null;
            }

            var raw = await response.Content.ReadFromJsonAsync<HereRouteRawResponse>(_jsonOptions);
            var route = raw?.routes?.FirstOrDefault();
            var sections = route?.sections;
            if (sections == null || sections.Count == 0)
            {
                Log.Warning("HERE Routing v8 polyline returned no sections (chunk {Cursor}-{End})", cursor);
                return null;
            }

            foreach (var section in sections)
            {
                if (string.IsNullOrEmpty(section.polyline)) continue;
                var decoded = FlexiblePolyline.Decode(section.polyline);
                if (decoded.Count == 0) continue;
                if (points.Count > 0 && SamePoint(points[^1], decoded[0]))
                    points.AddRange(decoded.Skip(1));
                else
                    points.AddRange(decoded);
            }

            if (chunkEnd == stops.Count - 1) break;
        }

        return points.Count == 0 ? null : points;
    }

    private void EnsureConfigured()
    {
        if (string.IsNullOrEmpty(appSettings.HereMapsApiKey))
        {
            Log.Warning("HereMapsApiKey not configured - findsequence2 proxy disabled");
            throw new InvalidOperationException("HereMapsApiKey env var (`HeremapApiKey`) is not set.");
        }
    }

    private static string FormatWaypoint(HereSequenceStop s) =>
        $"{Uri.EscapeDataString(string.IsNullOrEmpty(s.Name) ? "wp" : s.Name)};" +
        $"{s.Lat.ToString("0.######", CultureInfo.InvariantCulture)}," +
        $"{s.Lng.ToString("0.######", CultureInfo.InvariantCulture)}";

    private static string FormatLatLng(HereSequenceStop s) =>
        $"{s.Lat.ToString("0.######", CultureInfo.InvariantCulture)}," +
        $"{s.Lng.ToString("0.######", CultureInfo.InvariantCulture)}";

    private static bool SamePoint(LatLngDto a, LatLngDto b) =>
        Math.Abs(a.Lat - b.Lat) < 1e-7 && Math.Abs(a.Lng - b.Lng) < 1e-7;

    // HERE response shape (subset we consume). Property names match the JSON
    // exactly so the case-insensitive resolver + our camelCase resolver both
    // read them. Lowercase-first per HERE's schema.
    private sealed class HereRawResponse
    {
        public List<HereRawResult>? results { get; set; }
    }
    private sealed class HereRawResult
    {
        public List<HereRawWaypoint>? waypoints { get; set; }
        public string? time { get; set; }  // seconds
        public List<HereRawInterconnection>? interconnections { get; set; }
    }
    private sealed class HereRawWaypoint
    {
        public string? id { get; set; }
        public int sequence { get; set; }
    }
    private sealed class HereRawInterconnection
    {
        public string? fromWaypoint { get; set; }
        public string? toWaypoint { get; set; }
        public double time { get; set; }  // seconds
    }

    // -- HERE Routing v8 response shape (subset we consume) ----------------
    private sealed class HereRouteRawResponse
    {
        public List<HereRouteRaw>? routes { get; set; }
    }
    private sealed class HereRouteRaw
    {
        public List<HereRouteSectionRaw>? sections { get; set; }
    }
    private sealed class HereRouteSectionRaw
    {
        // Flexible-polyline encoded string. See FlexiblePolyline.Decode below.
        public string? polyline { get; set; }
    }
}

/// <summary>
/// HERE Flexible Polyline decoder. Ported from the reference JS implementation
/// at https://github.com/heremaps/flexible-polyline. HERE Routing v8 returns
/// route sections encoded in this format; the frontend needs plain lat/lng
/// arrays so we decode server-side.
///
/// Format: header (version + precision + 3d flag) followed by delta-encoded
/// varints of scaled coordinates. Supports 2D lat/lng; 3rd dimension (elevation
/// etc.) is skipped since we only need road geometry.
/// </summary>
internal static class FlexiblePolyline
{
    private const string Encoding =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    private static readonly int[] Decoding = BuildDecoding();

    public static List<LatLngDto> Decode(string encoded)
    {
        var result = new List<LatLngDto>();
        if (string.IsNullOrEmpty(encoded)) return result;

        var idx = 0;
        // Header: version (1), then a bit-packed value containing precision (3 bits),
        // 3rd-dim type (3 bits), 3rd-dim precision (4 bits).
        var version = DecodeUnsignedVarint(encoded, ref idx);
        if (version != 1) return result;
        var header = DecodeUnsignedVarint(encoded, ref idx);
        var precision = (int)(header & 15);
        var thirdDimType = (int)((header >> 4) & 7);
        var thirdDimPrecision = (int)((header >> 7) & 15);
        _ = thirdDimPrecision; // unused - we skip 3rd-dim values

        var factor = Math.Pow(10, precision);
        long lat = 0, lng = 0;
        while (idx < encoded.Length)
        {
            lat += DecodeSignedVarint(encoded, ref idx);
            if (idx >= encoded.Length) break;
            lng += DecodeSignedVarint(encoded, ref idx);
            if (thirdDimType != 0)
            {
                if (idx >= encoded.Length) break;
                // 3rd dimension present; consume + discard.
                DecodeSignedVarint(encoded, ref idx);
            }
            result.Add(new LatLngDto { Lat = lat / factor, Lng = lng / factor });
        }
        return result;
    }

    private static long DecodeUnsignedVarint(string s, ref int idx)
    {
        long value = 0;
        var shift = 0;
        while (idx < s.Length)
        {
            var ch = s[idx++];
            if (ch >= Decoding.Length) return 0;
            var v = Decoding[ch];
            if (v < 0) return 0;
            value |= (long)(v & 0x1F) << shift;
            if ((v & 0x20) == 0) return value;
            shift += 5;
        }
        return value;
    }

    private static long DecodeSignedVarint(string s, ref int idx)
    {
        var u = DecodeUnsignedVarint(s, ref idx);
        return ((u & 1) != 0) ? ~(u >> 1) : (u >> 1);
    }

    private static int[] BuildDecoding()
    {
        var arr = new int[128];
        for (var i = 0; i < arr.Length; i++) arr[i] = -1;
        for (var i = 0; i < Encoding.Length; i++) arr[Encoding[i]] = i;
        return arr;
    }
}
