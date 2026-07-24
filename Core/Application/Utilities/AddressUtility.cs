namespace RoutedOperations.Core.Application.Utilities;

// Ported verbatim from BulkImportHyper. Normalises a raw postcode string
// to the 4-digit NZ format the Despatch DB expects. Returns null when the
// input is empty / non-numeric / non-positive - the callers treat that
// as "no post code" rather than "0000".
public static class AddressUtility
{
    public static string FormatPostCode(string postcode)
    {
        return string.IsNullOrWhiteSpace(postcode) || !int.TryParse(postcode.Trim(), out int parsedPostCode) || parsedPostCode < 1
            ? null
            : parsedPostCode.ToString().PadLeft(4, '0');
    }
}
