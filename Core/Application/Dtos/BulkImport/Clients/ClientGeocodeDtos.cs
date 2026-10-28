namespace RoutedOperations.Core.Application.Dtos.BulkImport.Clients;

/// <summary>
/// Body for POST /api/clients/{clientId}/geocode (schedule-origin spec 4.5).
///
/// Two-step on purpose. The first call geocodes and returns the candidate;
/// the second call repeats it with <see cref="Confirm"/> set and writes. A
/// client's site coordinates decide where a client-origin run starts, so they
/// are never overwritten on the strength of one unseen lookup.
/// </summary>
public class ClientGeocodeRequest
{
    /// <summary>
    /// Address to geocode. Null or blank uses the client's saved site
    /// address, which is the normal case; the override exists for a client
    /// whose stored address does not geocode cleanly.
    /// </summary>
    public string Address { get; set; }

    /// <summary>
    /// False (the default) previews only. True writes tucClient.Latitude /
    /// Longitude.
    /// </summary>
    public bool Confirm { get; set; }
}

/// <summary>
/// Result of a geocode preview or write.
/// </summary>
public record ClientGeocodeResponse(
    int ClientId,
    string ClientName,
    /// <summary>The address actually sent to HERE.</summary>
    string AddressUsed,
    /// <summary>Candidate coordinates, null when HERE found nothing.</summary>
    double? Latitude,
    double? Longitude,
    string FormattedAddress,
    /// <summary>What the client had before this call, so the UI can show a
    /// "was X, now Y" confirmation rather than a bare new value.</summary>
    double? PreviousLatitude,
    double? PreviousLongitude,
    /// <summary>True only when this call wrote to tucClient.</summary>
    bool Written,
    string Message);
