using System.Text;

namespace RoutedOperations.Core.Application.Services.Territory;

/// <summary>
/// F4 (ZG3): read a re-uploaded zone group export and work out what it would
/// change. Pure, so the rules that decide what is written are unit tested
/// without a database; <see cref="TerritoryService"/> loads the group, calls
/// this, and does the writing.
///
/// The file is the one the Export CSV button writes (zoneGroupExport.ts):
/// header Zone,Postcode,Suburb, a UTF-8 BOM, RFC quoting, CRLF. It also has to
/// survive a round trip through Excel, which drops the BOM, may switch to LF,
/// and strips the leading zero off 0110. Codes are therefore compared as
/// numbers and re-spelled the way the tenant stores them (NZ: 4-digit display
/// of the int column; US: a 5-character string with the zero kept).
///
/// A group is keyed on (group, postcode): M0 measured 0 postcodes in two
/// zones of one group on local NZ and on Urgent prod, so one zone per code is
/// the shape, and a file or a group that breaks it is refused, not guessed.
///
/// Row numbers in messages are the spreadsheet's, with the header as row 1.
/// </summary>
public static class ZoneGroupCsvImport
{
    public sealed record ParsedRow(int Line, int Zone, string Code, string Suburb);
    /// <summary>A row that is only acceptable if it re-states what the group
    /// already holds: a code in a shape the paste would refuse (junk already
    /// stored, e.g. 8-digit US ZIPs), or a US row with no zone (ZoneNumber is
    /// nullable). <see cref="Diff"/> decides, since only it sees the group.
    /// Zone 0 means "no zone".</summary>
    public sealed record PendingRow(int Line, int Zone, string Code, string Error, bool Junk = false);
    public sealed record ParseResult(List<ParsedRow> Rows, List<string> Errors, List<PendingRow> Pending = null);
    public sealed record CurrentRow(int Id, string Code, int Zone);
    public sealed record AddedRow(int Line, string Code, int Zone, string Suburb, bool Unrecognised);
    public sealed record MovedRow(int Id, string Code, int FromZone, int ToZone, int Line, bool NewZone = false);
    public sealed record RemovedRow(int Id, string Code, int Zone);

    /// <summary>The preview. When <see cref="Errors"/> is non-empty the change
    /// lists are empty, so there is never a good half of a bad file to apply.
    /// Unrecognised codes are warnings and are also in <see cref="Added"/>.</summary>
    public sealed record ZoneGroupImportPreview(
        List<AddedRow> Added, List<MovedRow> Moved, List<RemovedRow> Removed,
        List<string> Unrecognised, int Unchanged, List<string> Errors, string Token);

    private static readonly string[] ExpectedHeader = { "Zone", "Postcode", "Suburb" };

    public static ParseResult Parse(string csv, bool isUs)
    {
        var rows = new List<ParsedRow>();
        var errors = new List<string>();
        var pending = new List<PendingRow>();
        var records = ReadRecords((csv ?? "").TrimStart('\uFEFF'), out var unclosedQuoteRow, out var unclosedQuoteCol);

        // An open quote runs to the end of the file, so every row after it
        // was read as part of one cell. Nothing in the file can be trusted.
        if (unclosedQuoteRow > 0)
        {
            errors.Add($"Row {unclosedQuoteRow}, column {unclosedQuoteCol}: a quote is opened and never closed.");
            return new ParseResult(rows, errors, pending);
        }

        if (records.Count == 0 || !IsHeader(records[0]))
        {
            errors.Add("Row 1: the first row must be the export header Zone,Postcode,Suburb. "
                + "Export the group, edit that file, and upload it again.");
            return new ParseResult(rows, errors, pending);
        }

        var noun = isUs ? "ZIP" : "postcode";
        var firstSeen = new Dictionary<string, ParsedRow>();
        for (var i = 1; i < records.Count; i++)
        {
            var line = i + 1;
            var cells = records[i];
            if (cells.All(string.IsNullOrWhiteSpace)) continue;

            var zoneText = Cell(cells, 0);
            var codeText = Cell(cells, 1);
            var suburb = Cell(cells, 2);

            var ok = true;
            string pendingError = null;
            var junk = false;
            // r1: a US ZIP may be stored with no zone (ZoneNumber NULL), and
            // the export writes that as blank (older exports wrote 0). Blank
            // or 0 is "no zone", allowed only where the group already has the
            // ZIP with no zone. NZ Zone is NOT NULL, so there it is an error.
            var noZone = isUs && (zoneText.Length == 0 || (int.TryParse(zoneText, out var z0) && z0 == 0));
            var zone = 0;
            if (noZone) { }
            else if (!int.TryParse(zoneText, out zone) || zone <= 0)
            {
                errors.Add($"Row {line}: zone \"{zoneText}\" is not a whole number above 0.");
                ok = false;
            }

            string code = null;
            if (codeText.Length == 0)
            {
                errors.Add($"Row {line}: the {noun} is empty.");
                ok = false;
            }
            // The paste rules: NZ takes 1 to 4 digits (PasteNzPostcodesAsync),
            // US 1 to 5 (PasteZoneZipsAsync). Anything longer is a typo or
            // junk, never a code to write.
            else if (codeText.Length > (isUs ? 5 : 4)
                     || !codeText.All(char.IsAsciiDigit) || !long.TryParse(codeText, out var number) || number <= 0)
            {
                // Refused unless the group already holds this exact code in
                // this zone, so a group with junk in it can still round trip.
                pendingError = $"Row {line}: \"{codeText}\" is not a {noun}.";
                junk = true;
                code = Canonical(codeText, isUs);
            }
            else
            {
                code = isUs
                    ? codeText.PadLeft(5, '0')
                    // The NZ column is an int, so this is the int's own spelling
                    // padded back to the four digits the export shows.
                    : number.ToString("D4");
            }

            if (!ok) continue;
            if (noZone && pendingError == null)
                pendingError = $"Row {line}: ZIP {code} has no zone number.";

            if (firstSeen.TryGetValue(code, out var earlier))
            {
                // The same row twice is a harmless repeat. Two zones is a
                // question only the operator can answer.
                if (earlier.Zone != zone)
                    errors.Add($"{(isUs ? "ZIP" : "Postcode")} {code} is on rows {earlier.Line} and {line} "
                        + $"with different zones ({earlier.Zone} and {zone}). Keep one of them.");
                continue;
            }

            var row = new ParsedRow(line, zone, code, suburb);
            firstSeen[code] = row;
            if (pendingError != null) pending.Add(new PendingRow(line, zone, code, pendingError, junk));
            else rows.Add(row);
        }

        if (rows.Count == 0 && pending.Count == 0 && errors.Count == 0)
            errors.Add($"The file has no {noun}s in it. Uploading it would empty the group, "
                + $"so to empty a group remove its {noun}s in the group itself.");

        return new ParseResult(rows, errors, pending);
    }

    /// <summary>The spelling a stored code is compared in, for a cell the
    /// paste rules refuse. US ZIPs are stored as text, so a refused one is
    /// compared as typed. NZ codes are stored as an int, so a stored junk code
    /// is a number above 9999 and is matched by its own spelling; a padded
    /// good code such as 00110 is kept as typed, so it can never pass as the
    /// group's 0110.</summary>
    private static string Canonical(string codeText, bool isUs)
    {
        if (isUs || !codeText.All(char.IsAsciiDigit) || !long.TryParse(codeText, out var n) || n <= 9999)
            return codeText;
        return n.ToString();
    }

    /// <param name="isKnown">Whether a code the group does not have yet is a
    /// real one for this tenant. There is no postcode master (M0 I-5), so the
    /// caller answers "has this tenant ever used it, in the right shape".</param>
    public static ZoneGroupImportPreview Diff(
        IReadOnlyList<CurrentRow> current, ParseResult parsed, Func<string, bool> isKnown)
    {
        var errors = new List<string>(parsed.Errors);

        foreach (var split in current.GroupBy(c => c.Code)
                     .Where(g => g.Select(c => c.Zone).Distinct().Count() > 1)
                     .OrderBy(g => g.Key))
        {
            var zones = string.Join(" and ", split.Select(c => c.Zone).Distinct().OrderBy(z => z));
            errors.Add($"{split.Key} is in zones {zones} of this group already. The file has one zone "
                + "per code, so it cannot say which to keep. Fix that code in the group first.");
        }

        var byCode = current.GroupBy(c => c.Code).ToDictionary(g => g.Key, g => g.ToList());
        var unchanged = 0;
        var inFile = parsed.Rows.Select(r => r.Code).ToHashSet();

        // r1 + junk: a pending row is fine only when it re-states the group.
        foreach (var p in parsed.Pending ?? new List<PendingRow>())
        {
            if (byCode.TryGetValue(p.Code, out var held) && held.All(c => c.Zone == p.Zone))
            {
                unchanged++;
                inFile.Add(p.Code);
            }
            // Nit 7: junk the group already stores cannot be put right from
            // the file (only re-stated as it is), so say where to fix it.
            else if (p.Junk && held != null)
                errors.Add(p.Error + " Fix or remove it in the group first.");
            else errors.Add(p.Error);
        }

        if (errors.Count > 0)
            return new ZoneGroupImportPreview(new(), new(), new(), new(), 0, errors, null);

        var added = new List<AddedRow>();
        var moved = new List<MovedRow>();
        // n-b: a move into a zone the group does not have yet creates it,
        // which is how a typo (9 for 1) would look. Flagged in the preview.
        var groupZones = current.Select(c => c.Zone).ToHashSet();

        foreach (var row in parsed.Rows)
        {
            if (!byCode.TryGetValue(row.Code, out var existing))
            {
                added.Add(new AddedRow(row.Line, row.Code, row.Zone, row.Suburb, !isKnown(row.Code)));
                continue;
            }

            var moves = existing.Where(c => c.Zone != row.Zone).ToList();
            if (moves.Count == 0) unchanged++;
            moved.AddRange(moves.Select(c => new MovedRow(c.Id, c.Code, c.Zone, row.Zone, row.Line, !groupZones.Contains(row.Zone))));
        }

        var removed = current.Where(c => !inFile.Contains(c.Code))
            .OrderBy(c => c.Zone).ThenBy(c => c.Code)
            .Select(c => new RemovedRow(c.Id, c.Code, c.Zone))
            .ToList();

        return new ZoneGroupImportPreview(
            added, moved, removed,
            added.Where(a => a.Unrecognised).Select(a => a.Code).ToList(),
            unchanged, errors, null);
    }

    private static bool IsHeader(List<string> cells) =>
        cells.Count >= 2
        && cells.Take(3).Select(c => c.Trim()).Zip(ExpectedHeader)
            .All(p => string.Equals(p.First, p.Second, StringComparison.OrdinalIgnoreCase));

    private static string Cell(List<string> cells, int i) => i < cells.Count ? (cells[i] ?? "").Trim() : "";

    /// <summary>RFC 4180: comma separated, double-quoted fields may hold
    /// commas, quotes ("") and line breaks; CRLF, LF or CR end a record. One
    /// record is one spreadsheet row, which is what the row numbers count.
    /// <paramref name="unclosedQuoteRow"/> and <paramref name="unclosedQuoteCol"/>
    /// are the cell a quote opened in and never closed (0 when every quote
    /// closed).</summary>
    private static List<List<string>> ReadRecords(string text, out int unclosedQuoteRow, out int unclosedQuoteCol)
    {
        var records = new List<List<string>>();
        var record = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        var any = false;
        var quoteRow = 0;
        var quoteCol = 0;

        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c == '"')
                {
                    if (i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                    else quoted = false;
                }
                else field.Append(c);
                continue;
            }

            switch (c)
            {
                case '"':
                    quoted = true;
                    quoteRow = records.Count + 1;
                    quoteCol = record.Count + 1;
                    any = true;
                    break;
                case ',':
                    record.Add(field.ToString());
                    field.Clear();
                    any = true;
                    break;
                case '\r':
                case '\n':
                    if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                    record.Add(field.ToString());
                    records.Add(record);
                    record = new List<string>();
                    field.Clear();
                    any = false;
                    break;
                default:
                    field.Append(c);
                    any = true;
                    break;
            }
        }

        unclosedQuoteRow = quoted ? quoteRow : 0;
        unclosedQuoteCol = quoted ? quoteCol : 0;
        if (any || field.Length > 0)
        {
            record.Add(field.ToString());
            records.Add(record);
        }
        return records;
    }
}
