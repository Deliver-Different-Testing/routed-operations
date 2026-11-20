using RoutedOperations.Core.Application.Services.Territory;
using static RoutedOperations.Core.Application.Services.Territory.ZoneGroupCsvImport;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// F4 (Marcus, 16 Nov release, step 7; ZG3 in round 2): re-upload the
/// exported Zone,Postcode,Suburb file to set a zone group. The parse and the
/// diff are pure so the rules that decide what gets written are pinned here:
///
///   * An untouched export must come back as zero changes. If it does not,
///     every re-upload quietly reshuffles coverage nobody edited.
///   * Excel strips the leading zero on re-save (0110 becomes 110). NZ codes
///     are ints in BulkZonePostcode, so 110 IS 0110 and must not read as a
///     remove plus an add.
///   * A bad row is named by its row number and nothing is written, because
///     a half-applied file leaves a group nobody can describe (spec test 8).
///   * One postcode in two zones of the file is ambiguous, so it is an error,
///     not a last-one-wins.
///   * Unrecognised (never seen in this tenant) is a warning: the row is
///     still added, because there is no postcode master to check against
///     (M0 I-5).
///   * A code of the wrong length (NZ more than 4 digits, US more than 5) is
///     NOT a warning but a row error, the paste's rule: a typo like 10240
///     would otherwise be written as a postcode (review M1, 19 Nov).
///   * A quote that is never closed swallows the rest of the file, so it is
///     an error and the file yields no rows (review M2).
/// </summary>
public class ZoneGroupCsvImportTests
{
    private const string Bom = "\uFEFF";

    // The current group: Whangarei 0110 in zone 1, Mt Eden in zone 2 with a
    // suburb that needs quoting, Ponsonby in zone 2.
    private static readonly IReadOnlyList<CurrentRow> Current = new List<CurrentRow>
    {
        new(11, "0110", 1),
        new(12, "1024", 2),
        new(13, "1011", 2),
    };

    private static readonly HashSet<string> TenantCodes = new() { "0110", "1024", "1011", "1010", "2010" };
    private static bool Known(string code) => TenantCodes.Contains(code);

    /// <summary>Exactly the bytes the Export CSV button writes for Current:
    /// BOM, CRLF, a quoted suburb.</summary>
    private static string Export(params string[] body) =>
        Bom + string.Join("\r\n", new[] { "Zone,Postcode,Suburb" }.Concat(body));

    private static readonly string[] Untouched =
    {
        "1,0110,Whangarei",
        "2,1011,Ponsonby",
        "2,1024,\"Mt Eden, Auckland\"",
    };

    private static ZoneGroupImportPreview Run(string csv, bool isUs = false, IReadOnlyList<CurrentRow> current = null)
    {
        var parsed = Parse(csv, isUs);
        return Diff(current ?? Current, parsed, Known);
    }

    [Fact]
    public void An_untouched_export_comes_back_as_no_change()
    {
        var p = Run(Export(Untouched));

        Assert.Empty(p.Errors);
        Assert.Empty(p.Added);
        Assert.Empty(p.Moved);
        Assert.Empty(p.Removed);
        Assert.Equal(3, p.Unchanged);
    }

    [Fact]
    public void Excel_dropping_the_leading_zero_is_still_the_same_postcode()
    {
        // Re-saved in Excel: no BOM, LF endings, 0110 became 110.
        var p = Run("Zone,Postcode,Suburb\n1,110,Whangarei\n2,1011,Ponsonby\n2,1024,\"Mt Eden, Auckland\"\n");

        Assert.Empty(p.Errors);
        Assert.Equal(3, p.Unchanged);
        Assert.Empty(p.Added);
        Assert.Empty(p.Removed);
    }

    [Fact]
    public void One_postcode_changed_zone_shows_as_one_move_and_nothing_else()
    {
        // Spec test 7: change one zone in the sheet.
        var p = Run(Export("1,0110,Whangarei", "1,1011,Ponsonby", "2,1024,\"Mt Eden, Auckland\""));

        Assert.Empty(p.Errors);
        var move = Assert.Single(p.Moved);
        Assert.Equal((13, "1011", 2, 1), (move.Id, move.Code, move.FromZone, move.ToZone));
        Assert.Empty(p.Added);
        Assert.Empty(p.Removed);
        Assert.Equal(2, p.Unchanged);
    }

    [Fact]
    public void A_new_row_is_added_and_a_missing_row_is_listed_as_removed()
    {
        var p = Run(Export("1,0110,Whangarei", "2,1024,\"Mt Eden, Auckland\"", "3,1010,Auckland Central"));

        var added = Assert.Single(p.Added);
        Assert.Equal(("1010", 3, "Auckland Central", false), (added.Code, added.Zone, added.Suburb, added.Unrecognised));
        var removed = Assert.Single(p.Removed);
        Assert.Equal((13, "1011", 2), (removed.Id, removed.Code, removed.Zone));
    }

    [Fact]
    public void An_unrecognised_code_is_a_warning_and_is_still_added()
    {
        // 9999 has never been in any group on this tenant. It does not stop
        // the file.
        var p = Run(Export(Untouched.Concat(new[] { "4,9999," }).ToArray()));

        Assert.Empty(p.Errors);
        Assert.Equal(new[] { "9999" }, p.Unrecognised.ToArray());
        Assert.True(Assert.Single(p.Added).Unrecognised);
    }

    [Theory]
    [InlineData("10240")]
    [InlineData("123456")]
    [InlineData("00110")]
    public void An_nz_code_longer_than_four_digits_is_a_row_error_not_an_add(string code)
    {
        // Review M1: the paste takes 1 to 4 digits. A typo in Excel must not
        // become a BulkZonePostcode row.
        var p = Run(Export(Untouched.Concat(new[] { $"1,{code},Typo" }).ToArray()));

        Assert.Equal($"Row 5: \"{code}\" is not a postcode.", Assert.Single(p.Errors));
        Assert.Empty(p.Added);
        Assert.Empty(p.Moved);
        Assert.Empty(p.Removed);
    }

    [Theory]
    [InlineData("123456")]
    [InlineData("99895077")]
    [InlineData("00501-1234")]
    [InlineData("ABCDE")]
    public void A_us_zip_that_is_not_one_to_five_digits_is_a_row_error(string zip)
    {
        // Review M1 + M3: the US paste takes 1 to 5 digits. A non-numeric ZIP
        // breaks every US quote (ZG-REPORT, Msg 245), a long one is junk.
        var current = new List<CurrentRow> { new(21, "00501", 1) };
        var p = Diff(current, Parse(Export("1,00501,A", $"1,{zip},B"), isUs: true), _ => true);

        Assert.Equal($"Row 3: \"{zip}\" is not a ZIP.", Assert.Single(p.Errors));
        Assert.Empty(p.Added);
    }

    [Fact]
    public void A_short_us_zip_is_padded_and_accepted()
    {
        var current = new List<CurrentRow> { new(21, "00501", 1) };
        var p = Diff(current, Parse(Export("1,501,A", "1,7030,B"), isUs: true), _ => true);

        Assert.Empty(p.Errors);
        Assert.Equal("07030", Assert.Single(p.Added).Code);
        Assert.Equal(1, p.Unchanged);
    }

    [Fact]
    public void A_quote_that_is_never_closed_is_an_error_and_yields_no_rows()
    {
        // Review M2 probe: the open quote on row 2 swallowed row 3, which then
        // read as "not in the file" and could be removed with the tick.
        var parsed = Parse(Export("1,0110,\"Whangarei", "2,1024,Mt Eden", "2,1011,Ponsonby"), isUs: false);

        // Review n-c (20 Nov): the message names the cell, so a stray quote
        // in a long sheet can be found.
        Assert.Equal("Row 2, column 3: a quote is opened and never closed.", Assert.Single(parsed.Errors));
        Assert.Empty(parsed.Rows);

        var p = Diff(Current, parsed, Known);
        Assert.Empty(p.Removed);
        Assert.Empty(p.Added);
    }

    [Fact]
    public void A_closed_quote_with_a_line_break_inside_is_still_fine()
    {
        var p = Run(Export("1,0110,\"Whangarei\r\nNorthland\"", "2,1011,Ponsonby", "2,1024,\"Mt Eden, Auckland\""));

        Assert.Empty(p.Errors);
        Assert.Equal(3, p.Unchanged);
    }

    [Fact]
    public void A_bad_row_is_named_and_the_preview_carries_no_changes()
    {
        // Spec test 8. Row numbers are the spreadsheet's, header = row 1.
        var p = Run(Export("1,0110,Whangarei", "x,1011,Ponsonby", "2,AB12,Somewhere"));

        Assert.Equal(2, p.Errors.Count);
        Assert.Contains(p.Errors, e => e.StartsWith("Row 3:") && e.Contains("zone"));
        Assert.Contains(p.Errors, e => e.StartsWith("Row 4:") && e.Contains("AB12"));
        // Nothing to apply when the file has an error, so a caller cannot
        // write the good half of it.
        Assert.Empty(p.Added);
        Assert.Empty(p.Moved);
        Assert.Empty(p.Removed);
    }

    [Fact]
    public void The_same_postcode_in_two_zones_of_the_file_is_an_error_naming_both_rows()
    {
        var p = Run(Export("1,0110,Whangarei", "2,0110,Whangarei", "2,1011,Ponsonby", "2,1011,Ponsonby", "2,1024,"));

        var error = Assert.Single(p.Errors);
        Assert.Contains("0110", error);
        Assert.Contains("rows 2 and 3", error);
        // The same postcode twice in the SAME zone is just a repeat.
        Assert.DoesNotContain(p.Errors, e => e.Contains("1011"));
    }

    [Fact]
    public void A_file_without_the_export_header_is_refused()
    {
        var p = Run("Postcode,Zone\n0110,1\n");

        var error = Assert.Single(p.Errors);
        Assert.StartsWith("Row 1:", error);
        Assert.Contains("Zone,Postcode,Suburb", error);
    }

    [Fact]
    public void An_empty_file_is_refused_rather_than_removing_everything()
    {
        var p = Run(Export());

        Assert.NotEmpty(p.Errors);
        Assert.Empty(p.Removed);
    }

    [Fact]
    public void A_group_that_already_holds_one_code_in_two_zones_cannot_take_a_file()
    {
        // The file has one zone per postcode, so it cannot say which of the
        // two rows to keep. Not seen on any tenant measured, refused if it is.
        var current = new List<CurrentRow> { new(1, "0110", 1), new(2, "0110", 2) };
        var p = Run(Export("1,0110,Whangarei"), current: current);

        Assert.Contains(p.Errors, e => e.Contains("0110") && e.Contains("zones 1 and 2"));
    }

    [Fact]
    public void Us_zips_are_padded_to_five_and_the_zone_name_column_is_ignored()
    {
        // The US export carries the zone NAME in the third column.
        var current = new List<CurrentRow> { new(21, "07030", 1), new(22, "64030", 2) };
        var csv = Export("1,7030,KC Mon+Thu", "2,64030,KC OUTER");

        var p = Diff(current, Parse(csv, isUs: true), z => z is "07030" or "64030");

        Assert.Empty(p.Errors);
        Assert.Equal(2, p.Unchanged);
    }

    // ─── round 2 review (20 Nov) ─────────────────────────────────────────

    [Fact]
    public void A_hand_typed_quote_inside_a_cell_names_its_row_and_column()
    {
        // n-c: O"Brien typed by hand in the suburb column.
        var parsed = Parse(Export("1,0110,O\"Brien", "2,1024,Mt Eden"), isUs: false);

        Assert.Equal("Row 2, column 3: a quote is opened and never closed.", Assert.Single(parsed.Errors));
    }

    [Theory]
    [InlineData("")]
    [InlineData("0")]
    public void Us_a_zip_with_no_zone_that_is_stored_with_no_zone_is_unchanged(string zone)
    {
        // r1: ZoneNumber is NULL on some US rows (19 on Medical, 7 on the
        // seed). The export writes it blank (older exports wrote 0); sending
        // the file straight back must not be an error the operator cannot
        // fix in the sheet.
        var current = new List<CurrentRow> { new(1, "00501", 0), new(2, "00601", 1) };
        var p = Diff(current, Parse(Export($"{zone},00501,SMF", "1,00601,A"), isUs: true), _ => true);

        Assert.Empty(p.Errors);
        Assert.Equal(2, p.Unchanged);
        Assert.Empty(p.Moved);
        Assert.Empty(p.Removed);
    }

    [Fact]
    public void Us_a_new_zip_with_no_zone_is_a_row_error()
    {
        // r1: blank means "no zone" only for a row that already has none. A
        // new ZIP with no zone could never be reached by a schedule tick.
        var current = new List<CurrentRow> { new(2, "00601", 1) };
        var p = Diff(current, Parse(Export("1,00601,A", ",64030,B"), isUs: true), _ => true);

        Assert.Equal("Row 3: ZIP 64030 has no zone number.", Assert.Single(p.Errors));
        Assert.Empty(p.Added);
    }

    [Fact]
    public void Us_a_blank_zone_does_not_take_a_zip_out_of_its_zone()
    {
        // r1: blanking the zone of a ZIP that has one is not "no change".
        var current = new List<CurrentRow> { new(2, "00601", 1) };
        var p = Diff(current, Parse(Export(",00601,A"), isUs: true), _ => true);

        Assert.Equal("Row 2: ZIP 00601 has no zone number.", Assert.Single(p.Errors));
        Assert.Empty(p.Moved);
    }

    [Fact]
    public void Nz_a_blank_zone_is_still_an_error()
    {
        // r1 is US only: the NZ Zone column is NOT NULL, so a blank zone
        // never matches anything stored.
        var p = Run(Export(",0110,Whangarei", "2,1011,Ponsonby", "2,1024,"));

        Assert.Equal("Row 2: zone \"\" is not a whole number above 0.", Assert.Single(p.Errors));
    }

    [Fact]
    public void A_junk_code_the_group_already_holds_can_stay_unchanged()
    {
        // FIX-REPORT: US "ABQ Test Zone" holds 7- and 8-digit ZIPs. The file
        // only re-states what is stored, so it must not be refused for them.
        var current = new List<CurrentRow> { new(1, "87101", 1), new(2, "99895077", 1) };
        var p = Diff(current, Parse(Export("1,87101,A", "1,99895077,A", "1,87102,A"), isUs: true), _ => true);

        Assert.Empty(p.Errors);
        Assert.Equal(2, p.Unchanged);
        Assert.Equal("87102", Assert.Single(p.Added).Code);
        Assert.Empty(p.Removed);
    }

    [Fact]
    public void A_junk_code_the_group_holds_cannot_be_moved_by_the_file()
    {
        // Unchanged is tolerated; writing the junk somewhere new is not.
        var current = new List<CurrentRow> { new(11, "0110", 1), new(12, "10240", 2) };
        var p = Diff(current, Parse(Export("1,0110,W", "3,10240,M"), isUs: false), Known);

        // Nit 7: the junk is already stored, so the fix is in the group.
        Assert.Equal("Row 3: \"10240\" is not a postcode. Fix or remove it in the group first.", Assert.Single(p.Errors));
        Assert.Empty(p.Moved);
    }

    [Fact]
    public void A_junk_code_left_out_of_the_file_is_listed_as_not_in_the_file()
    {
        var current = new List<CurrentRow> { new(11, "0110", 1), new(12, "10240", 2) };
        var p = Diff(current, Parse(Export("1,0110,W"), isUs: false), Known);

        Assert.Empty(p.Errors);
        Assert.Equal("10240", Assert.Single(p.Removed).Code);
    }

    [Fact]
    public void Nz_a_move_to_a_zone_the_group_does_not_have_is_marked_new_zone()
    {
        // n-b: a typo (9 for 1) would create zone 9. Shown, not refused.
        var p = Run(Export("9,0110,Whangarei", "1,1011,Ponsonby", "2,1024,"));

        Assert.Empty(p.Errors);
        Assert.True(p.Moved.Single(m => m.Code == "0110").NewZone);
        Assert.False(p.Moved.Single(m => m.Code == "1011").NewZone);
    }
}
