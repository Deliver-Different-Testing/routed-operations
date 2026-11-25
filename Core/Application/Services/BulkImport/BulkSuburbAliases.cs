using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Core.Application.Services.BulkImport;

// #333: remembered suburb fixes (dbo.tblBulkSuburbAlias). ONE normaliser
// shared by the endpoints, the routed import and Staff Import, mirrored in
// the wizard's suburbAliases.ts; change both together.
public static class BulkSuburbAliases
{
    // NFD minus diacritics, lower case, single spaces, dots read as spaces
    // ("Mt.Eden"), and the common abbreviations spelled out so "Mt Eden" and
    // "Mount Eden", "Pt Chevalier" and "Point Chevalier" are one value.
    public static string Normalise(string suburb)
    {
        if (string.IsNullOrWhiteSpace(suburb)) return string.Empty;
        var words = StripMarks(suburb).ToLowerInvariant()
            .Split(new[] { ' ', '.' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(w => w switch { "mt" => "mount", "st" => "saint", "pt" => "point", _ => w });
        return string.Join(' ', words);
    }

    // Exact spelling bar diacritics, case, spacing and trailing dots: every
    // run of spaces (tab, NBSP) is one space, then outer spaces and trailing
    // dots go. An inner dot stays, so "St. Albans" is not "St Albans" and is
    // still asked about when Saint Albans also exists. No abbreviation is
    // expanded. Applied to the tucSuburb names and the sheet alike. Same
    // rule as exactKey in suburbAliases.ts.
    private static readonly Regex ExactSpacing = new(@"[\p{Z}\t\n\r\f\v]+", RegexOptions.Compiled);
    private static readonly Regex ExactEnds = new(@"^ +|[ .]+$", RegexOptions.Compiled);

    private static string ExactKey(string suburb) =>
        suburb == null ? string.Empty
            : ExactEnds.Replace(ExactSpacing.Replace(StripMarks(suburb).ToLowerInvariant(), " "), string.Empty);

    // NFD minus non-spacing marks (the wizard strips \p{Mn}, the same set).
    private static string StripMarks(string value)
    {
        var sb = new StringBuilder();
        foreach (var ch in value.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) sb.Append(ch);
        }
        return sb.ToString();
    }

    // Exact spelling only (bar diacritics, case and outer spaces). Checked
    // BEFORE a remembered fix: alias keys are normalised, so a fix saved for
    // 'St. Albans' must not capture a sheet 'St Albans', a real suburb.
    public static Func<string, string> ExactSuburbMatcher(IEnumerable<string> names)
    {
        var exact = new Dictionary<string, string>();
        foreach (var name in names)
        {
            var key = ExactKey(name);
            if (key.Length > 0) exact.TryAdd(key, name);
        }
        return raw =>
        {
            var key = ExactKey(raw);
            return key.Length > 0 && exact.TryGetValue(key, out var hit) ? hit : null;
        };
    }

    // Matches a sheet suburb to one of these names. The exact spelling wins;
    // the normalised match ("Mt Eden" = "Mount Eden") is used only when it
    // points at a single name, so two real suburbs that normalise alike
    // ("St Albans", "Saint Albans") are never guessed between.
    public static Func<string, string> SuburbMatcher(IEnumerable<string> names)
    {
        var exact = new Dictionary<string, string>();
        var normalised = new Dictionary<string, HashSet<string>>();
        foreach (var name in names.Where(n => !string.IsNullOrWhiteSpace(n)))
        {
            exact.TryAdd(ExactKey(name), name);
            var key = Normalise(name);
            if (!normalised.TryGetValue(key, out var set)) normalised[key] = set = new HashSet<string>();
            set.Add(ExactKey(name));
        }
        return raw =>
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            if (exact.TryGetValue(ExactKey(raw), out var hit)) return hit;
            return normalised.TryGetValue(Normalise(raw), out var set) && set.Count == 1 ? exact[set.First()] : null;
        };
    }

    // NZ: digits padded to 4 (Excel drops the leading zero). US: trimmed.
    public static string NormalisePostCode(string postCode, bool isNz)
    {
        if (string.IsNullOrWhiteSpace(postCode)) return null;
        var trimmed = postCode.Trim();
        if (!isNz) return trimmed;
        var digits = new string(trimmed.Where(char.IsDigit).ToArray());
        return digits.Length > 0 ? digits.PadLeft(4, '0') : trimmed;
    }

    // Order: the client's postcode-specific fix, the client's postcode-less
    // fix, then the same two tenant-wide (ClientId NULL). Another client's
    // rows never match.
    public static TblBulkSuburbAlias Find(IEnumerable<TblBulkSuburbAlias> rows, int? clientId, string suburb, string postCode, bool isNz)
    {
        var key = Normalise(suburb);
        if (key.Length == 0 || rows == null) return null;
        var pc = NormalisePostCode(postCode, isNz);
        return rows
            .Where(r => r.RawSuburb == key && (r.RawPostCode == null || r.RawPostCode == pc))
            .Where(r => r.ClientId == null || r.ClientId == clientId)
            .OrderBy(r => r.ClientId == null ? 1 : 0)
            .ThenBy(r => r.RawPostCode == null ? 1 : 0)
            .FirstOrDefault();
    }

    // Rows for these clients plus the tenant-wide rows. Small table, so the
    // import loads them once per request and matches in memory.
    public static Task<List<TblBulkSuburbAlias>> LoadAsync(DynamicDespatchDbContext context, IEnumerable<int> clientIds)
    {
        var ids = clientIds?.Distinct().ToList() ?? new List<int>();
        return context.TblBulkSuburbAliases.AsNoTracking()
            .Where(a => a.ClientId == null || ids.Contains(a.ClientId.Value))
            .ToListAsync();
    }
}
