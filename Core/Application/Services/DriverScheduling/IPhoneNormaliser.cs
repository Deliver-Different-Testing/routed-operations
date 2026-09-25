namespace RoutedOperations.Core.Application.Services.DriverScheduling;

/// <summary>
/// Per-tenant phone number normaliser for the outbound SMS path
/// (`tucManualMessage.SendToMobile`). CourierManager's legacy scheduler
/// hard-coded `.Replace("+64", "0").Replace(" ", "")` in five places -
/// safe for NZ tenants only. For Day-1 US live we need the country
/// mapping to live behind an interface so the caller reads the
/// operator's `CountryCode` auth claim and gets the right transform.
///
/// Contract: input is whatever shape the courier's stored mobile has
/// (`+64 21 555 1234`, `021 555 1234`, `+1 555 555 1234`, `555-555-1234`);
/// output is the SMS provider's expected local shape. Whitespace is
/// stripped in every code path.
/// </summary>
public interface IPhoneNormaliser
{
    /// <summary>Normalise the raw mobile string for the outbound SMS
    /// gateway using the current auth claim's CountryCode.</summary>
    string NormaliseForSms(string rawMobile);
}
