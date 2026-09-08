using System.Security.Claims;
using Microsoft.AspNetCore.Http;

namespace RoutedOperations.Core.Application.Services.DriverScheduling;

/// <summary>
/// Reads the auth-claim `CountryCode` (populated by HomeController from
/// the Hub cookie) and applies the country-specific mobile-number
/// transform the SMS provider expects.
///
/// Behaviour:
///   NZ  ->  strip leading +64 (or 0064), leave a leading `0`, strip
///           every whitespace character. Matches legacy CourierManager
///           `.Replace("+64", "0").Replace(" ", "")` byte-for-byte.
///   US  ->  strip leading +1, strip every whitespace character +
///           common separator chars ('-', '(', ')', '.'). SMS provider
///           expects the bare 10-digit form.
///   default -> whitespace strip only (safe minimum for unknown
///              tenants; falls through unchanged for numbers already
///              in the provider's expected shape).
///
/// Registered scoped in Program.cs so the IHttpContextAccessor picks
/// up the current-request claims.
/// </summary>
public class PhoneNormaliser(IHttpContextAccessor httpContextAccessor) : IPhoneNormaliser
{
    public string NormaliseForSms(string rawMobile)
    {
        if (string.IsNullOrWhiteSpace(rawMobile)) return string.Empty;

        var country = httpContextAccessor.HttpContext?.User
            .FindFirstValue("CountryCode");

        var trimmed = rawMobile.Trim();

        if (string.Equals(country, "NZ", StringComparison.OrdinalIgnoreCase))
        {
            // NZ: legacy transform. Strip +64 (or 0064) prefix, replace
            // with a plain 0, drop every whitespace char.
            var stripped = trimmed.StartsWith("0064", StringComparison.Ordinal)
                ? "0" + trimmed[4..]
                : trimmed.Replace("+64", "0");
            return stripped.Replace(" ", string.Empty);
        }

        if (string.Equals(country, "US", StringComparison.OrdinalIgnoreCase))
        {
            // US: strip +1 (or leading 1 on 11-digit forms), drop
            // whitespace + common separators.
            var stripped = trimmed.StartsWith("+1", StringComparison.Ordinal)
                ? trimmed[2..]
                : trimmed;
            return new string(stripped.Where(c => !char.IsWhiteSpace(c) && c != '-' && c != '(' && c != ')' && c != '.').ToArray());
        }

        // Unknown tenant: whitespace-strip only. Preserves whatever
        // shape the DB has without misapplying a country transform.
        return trimmed.Replace(" ", string.Empty);
    }
}
