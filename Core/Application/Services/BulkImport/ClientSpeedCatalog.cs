using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.BulkImport;

public sealed record ClientSpeed(int Id, string? Name, string? ShortName, string? SystemName, bool TruckJobEntry)
{
    /// <summary>A speed bulk import sends down the truck path (Steve decision 4).</summary>
    public bool IsBulkTruck => TruckJobEntry && BulkTruckSpeeds.Allowed.Contains(Id);
}

/// <summary>
/// The speeds a client may book: its own list, else the default list. One
/// definition, so the wizard's dropdown and the server's per-row check agree.
/// </summary>
public static class ClientSpeedCatalog
{
    public static async Task<List<ClientSpeed>> LoadAsync(DespatchContext context, int clientId)
    {
        var own = await context.TblClientAvailableSpeeds
            .Where(s => s.ClientId == clientId && s.Active && s.WebVisible == true)
            .OrderBy(s => s.Speed.UcjtName)
            .Select(s => new ClientSpeed(
                s.Speed.UcjtId, s.Speed.UcjtName, s.Speed.ShortName, s.Speed.SystemName, s.Speed.TruckJobEntry == true))
            .ToListAsync();
        if (own.Count > 0) return own;

        return await context.TblClientDefaultAvailableSpeeds
            .Where(s => s.Name == "API - Web Integration" && s.Active)
            .OrderBy(s => s.Speed.UcjtName)
            .Select(s => new ClientSpeed(
                s.Speed.UcjtId, s.Speed.UcjtName, s.Speed.ShortName, s.Speed.SystemName, s.Speed.TruckJobEntry == true))
            .ToListAsync();
    }

    /// <summary>
    /// Matches a file's Speed value: id, then short code (TECO), system name
    /// (TY) or display name (Truck Economy), ignoring case and padding.
    /// </summary>
    public static ClientSpeed? Match(IReadOnlyList<ClientSpeed> speeds, string? value)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        if (int.TryParse(v, out var id)) return speeds.FirstOrDefault(s => s.Id == id);
        return speeds.FirstOrDefault(s =>
            string.Equals(s.ShortName?.Trim(), v, StringComparison.OrdinalIgnoreCase)
            || string.Equals(s.SystemName?.Trim(), v, StringComparison.OrdinalIgnoreCase)
            || string.Equals(s.Name?.Trim(), v, StringComparison.OrdinalIgnoreCase));
    }
}
