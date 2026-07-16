using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using RoutedOperations.Core.Application.Dtos.Route;
using RoutedOperations.Infrastructure;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Route;

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
}
