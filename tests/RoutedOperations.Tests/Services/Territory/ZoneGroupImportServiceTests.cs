using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Territory;
using RoutedOperations.Core.Application.Services.Territory;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// F4 re-upload, through the service against SQLite so the transaction and
/// the "group changed since the preview" check are real. What these pin:
///
///   * Apply writes exactly what the preview showed: a moved row keeps its id
///     and only its zone changes, so anything else hanging off the row is not
///     disturbed (spec test 7).
///   * A file with a bad row writes nothing at all (spec test 8).
///   * Rows missing from the file are only deleted when the caller ticked
///     "also remove" (M0 I-6). Without the tick they stay.
///   * If someone edited the group between preview and apply, the apply
///     refuses: the operator approved a diff against a group that no longer
///     exists.
///   * US: the group's rows are ZoneZip by ZoneZipGroupId, and a ZIP joins a
///     zone by taking that zone's ZoneName from the group's own rows, never
///     an invented one.
/// </summary>
public class ZoneGroupImportServiceTests
{
    private const string Header = "Zone,Postcode,Suburb";

    private static TerritoryService Svc(DbContextOptions<DespatchContext> opts, string country)
    {
        var accessor = Substitute.For<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new List<Claim>
        {
            new("CountryCode", country),
            new(ClaimTypes.Email, "kevin@urgent.co.nz"),
        }));
        accessor.HttpContext.Returns(ctx);
        return new TerritoryService(CockpitTestHarness.Factory(opts), accessor);
    }

    private static (DbContextOptions<DespatchContext>, System.Data.Common.DbConnection) SeedNz()
    {
        var (opts, conn) = CockpitTestHarness.NewSqliteOptions();
        using var db = CockpitTestHarness.Context(opts);
        db.BulkZonePostcodeGroups.AddRange(
            new BulkZonePostcodeGroup { Id = 5, Name = "Auckland chilled", DepotId = 3 },
            new BulkZonePostcodeGroup { Id = 6, Name = "Someone else's group", DepotId = 3 });
        db.BulkZonePostcodes.AddRange(
            new BulkZonePostcode { Id = 11, PostcodeGroupId = 5, PostCode = 110, Zone = 1, Name = "Whangarei", DepotId = 3, Created = DateTime.UtcNow },
            new BulkZonePostcode { Id = 12, PostcodeGroupId = 5, PostCode = 1024, Zone = 2, Name = "Mt Eden, Auckland", DepotId = 3, Created = DateTime.UtcNow },
            new BulkZonePostcode { Id = 13, PostcodeGroupId = 5, PostCode = 1011, Zone = 2, Name = "Ponsonby", DepotId = 3, Created = DateTime.UtcNow },
            // Same postcode in another group: its suburb is what an added row inherits.
            new BulkZonePostcode { Id = 20, PostcodeGroupId = 6, PostCode = 1010, Zone = 1, Name = "Auckland Central", DepotId = 3, Created = DateTime.UtcNow });
        db.SaveChanges();
        return (opts, conn);
    }

    private static List<(int Id, int Code, int Zone)> GroupRows(DbContextOptions<DespatchContext> opts, int groupId)
    {
        using var db = CockpitTestHarness.Context(opts);
        return db.BulkZonePostcodes.AsNoTracking().Where(p => p.PostcodeGroupId == groupId)
            .OrderBy(p => p.Id).Select(p => new { p.Id, p.PostCode, p.Zone }).ToList()
            .Select(p => (p.Id, p.PostCode, p.Zone)).ToList();
    }

    private static string Csv(params string[] rows) => "\uFEFF" + string.Join("\r\n", new[] { Header }.Concat(rows));

    private static ZoneGroupImportRequest Req(string csv, string token, bool removeMissing = false) =>
        new() { Csv = csv, Token = token, RemoveMissing = removeMissing };

    [Fact]
    public async Task Spec_test_7_one_moved_postcode_previews_as_one_move_and_applies_as_one_zone_change()
    {
        var (opts, conn) = SeedNz();
        using var _ = conn;
        var svc = Svc(opts, "NZ");
        var csv = Csv("1,0110,Whangarei", "1,1011,Ponsonby", "2,1024,\"Mt Eden, Auckland\"");

        var preview = await svc.PreviewZoneGroupImportAsync(5, Req(csv, null));
        Assert.Single(preview.Moved);
        Assert.Empty(preview.Added);
        Assert.Empty(preview.Removed);
        Assert.False(string.IsNullOrEmpty(preview.Token));

        var result = await svc.ApplyZoneGroupImportAsync(5, Req(csv, preview.Token));

        Assert.Equal((0, 1, 0), (result.Added, result.Moved, result.Removed));
        // Same row ids, only 1011's zone changed.
        Assert.Equal(new[] { (11, 110, 1), (12, 1024, 2), (13, 1011, 1) }, GroupRows(opts, 5));
        // The list the modal reads agrees.
        var detail = await svc.GetPostcodeGroupDetailAsync(5);
        Assert.Equal(new[] { "0110", "1011" }, detail.Zones.Single(z => z.Zone == 1).Members.Select(m => m.Code).ToArray());
    }

    [Fact]
    public async Task Spec_test_8_a_bad_row_is_named_and_nothing_is_written()
    {
        var (opts, conn) = SeedNz();
        using var _ = conn;
        var svc = Svc(opts, "NZ");
        var before = GroupRows(opts, 5);
        // A good move on row 2 and a bad zone on row 3: the move must not land.
        var csv = Csv("2,0110,Whangarei", "zone two,1011,Ponsonby", "2,1024,");

        var preview = await svc.PreviewZoneGroupImportAsync(5, Req(csv, null));
        Assert.Contains(preview.Errors, e => e.StartsWith("Row 3:"));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.ApplyZoneGroupImportAsync(5, Req(csv, preview.Token)));
        Assert.Contains("Row 3:", ex.Message);
        Assert.Contains("Nothing was saved", ex.Message);
        Assert.Equal(before, GroupRows(opts, 5));
    }

    [Fact]
    public async Task A_five_digit_nz_code_is_refused_and_nothing_is_written()
    {
        // Review M1: 10240 is a typo, not an "unrecognised" postcode to add.
        var (opts, conn) = SeedNz();
        using var _ = conn;
        var svc = Svc(opts, "NZ");
        var before = GroupRows(opts, 5);
        var csv = Csv("1,0110,Whangarei", "2,1011,Ponsonby", "2,1024,", "3,10240,Typo");

        var preview = await svc.PreviewZoneGroupImportAsync(5, Req(csv, null));
        Assert.Equal("Row 5: \"10240\" is not a postcode.", Assert.Single(preview.Errors));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.ApplyZoneGroupImportAsync(5, Req(csv, preview.Token)));
        Assert.Contains("Row 5:", ex.Message);
        Assert.Equal(before, GroupRows(opts, 5));
    }

    [Fact]
    public async Task Missing_rows_stay_unless_the_remove_tick_was_given()
    {
        var (opts, conn) = SeedNz();
        using var _ = conn;
        var svc = Svc(opts, "NZ");
        // 1011 left out; 1010 added to zone 3.
        var csv = Csv("1,0110,Whangarei", "2,1024,", "3,1010,");

        var preview = await svc.PreviewZoneGroupImportAsync(5, Req(csv, null));
        Assert.Single(preview.Removed);

        var kept = await svc.ApplyZoneGroupImportAsync(5, Req(csv, preview.Token, removeMissing: false));
        Assert.Equal((1, 0, 0, 1), (kept.Added, kept.Moved, kept.Removed, kept.KeptNotInFile));
        Assert.Contains(GroupRows(opts, 5), r => r.Code == 1011);

        var again = await svc.PreviewZoneGroupImportAsync(5, Req(csv, null));
        var removed = await svc.ApplyZoneGroupImportAsync(5, Req(csv, again.Token, removeMissing: true));
        Assert.Equal((0, 0, 1), (removed.Added, removed.Moved, removed.Removed));
        Assert.DoesNotContain(GroupRows(opts, 5), r => r.Code == 1011);
        // The other group was never touched.
        Assert.Single(GroupRows(opts, 6));
    }

    [Fact]
    public async Task An_added_postcode_inherits_its_suburb_when_the_file_leaves_it_blank()
    {
        var (opts, conn) = SeedNz();
        using var _ = conn;
        var svc = Svc(opts, "NZ");
        var csv = Csv("1,0110,Whangarei", "2,1011,Ponsonby", "2,1024,", "3,1010,");

        var preview = await svc.PreviewZoneGroupImportAsync(5, Req(csv, null));
        await svc.ApplyZoneGroupImportAsync(5, Req(csv, preview.Token));

        using var db = CockpitTestHarness.Context(opts);
        var row = db.BulkZonePostcodes.Single(p => p.PostcodeGroupId == 5 && p.PostCode == 1010);
        Assert.Equal(("Auckland Central", 3, 3), (row.Name, row.Zone, row.DepotId));
        // A blank suburb on an EXISTING row is not a request to clear it.
        Assert.Equal("Mt Eden, Auckland", db.BulkZonePostcodes.Single(p => p.Id == 12).Name);
    }

    [Fact]
    public async Task Apply_refuses_when_the_group_changed_after_the_preview()
    {
        var (opts, conn) = SeedNz();
        using var _ = conn;
        var svc = Svc(opts, "NZ");
        var csv = Csv("1,0110,Whangarei", "1,1011,Ponsonby", "2,1024,");
        var preview = await svc.PreviewZoneGroupImportAsync(5, Req(csv, null));

        // Someone moves a postcode in another tab.
        using (var db = CockpitTestHarness.Context(opts))
        {
            db.BulkZonePostcodes.Single(p => p.Id == 12).Zone = 4;
            db.SaveChanges();
        }

        // r3: the stale refusal is its own type so the controller can mark it.
        var ex = await Assert.ThrowsAsync<ZoneGroupImportStaleException>(
            () => svc.ApplyZoneGroupImportAsync(5, Req(csv, preview.Token)));
        Assert.Contains("changed since", ex.Message);
        Assert.Contains(GroupRows(opts, 5), r => r is { Code: 1011, Zone: 2 });
    }

    // ─── US ──────────────────────────────────────────────────────────────

    private static (DbContextOptions<DespatchContext>, System.Data.Common.DbConnection) SeedUs()
    {
        var (opts, conn) = CockpitTestHarness.NewSqliteOptions();
        using var db = CockpitTestHarness.Context(opts);
        db.BulkZonePostcodeGroups.Add(new BulkZonePostcodeGroup { Id = 7, Name = "KC coverage", DepotId = 29 });
        db.ZoneNames.AddRange(
            new ZoneName { ZoneNameId = 1, ZoneName1 = "KC Mon+Thu", LocationId = 29 },
            new ZoneName { ZoneNameId = 2, ZoneName1 = "KC OUTER", LocationId = 29 });
        db.ZoneZips.AddRange(
            new ZoneZip { ZoneZipId = 1, Zip = "64030", ZoneNumber = 1, ZoneNameId = 1, ZoneZipGroupId = 7, ApplyCongestion = false },
            new ZoneZip { ZoneZipId = 2, Zip = "64031", ZoneNumber = 1, ZoneNameId = 1, ZoneZipGroupId = 7, ApplyCongestion = false },
            new ZoneZip { ZoneZipId = 3, Zip = "65201", ZoneNumber = 2, ZoneNameId = 2, ZoneZipGroupId = 7, ApplyCongestion = false },
            // Not in any group: a pricing row the import must never touch.
            new ZoneZip { ZoneZipId = 4, Zip = "64031", ZoneNumber = 9, ZoneNameId = 2, ZoneZipGroupId = null, ApplyCongestion = true });
        db.SaveChanges();
        return (opts, conn);
    }

    [Fact]
    public async Task Us_a_moved_and_an_added_zip_take_the_zone_name_from_the_groups_own_rows()
    {
        var (opts, conn) = SeedUs();
        using var _ = conn;
        var svc = Svc(opts, "US");
        // 64031 moves 1 -> 2, 7030 (07030) joins zone 2.
        var csv = Csv("1,64030,KC Mon+Thu", "2,64031,KC Mon+Thu", "2,65201,KC OUTER", "2,7030,");

        var preview = await svc.PreviewZoneGroupImportAsync(7, Req(csv, null));
        Assert.Empty(preview.Errors);
        Assert.Equal("07030", Assert.Single(preview.Added).Code);
        Assert.Single(preview.Moved);

        await svc.ApplyZoneGroupImportAsync(7, Req(csv, preview.Token));

        using var db = CockpitTestHarness.Context(opts);
        var moved = db.ZoneZips.Single(z => z.ZoneZipId == 2);
        Assert.Equal((2, 2, 7), (moved.ZoneNumber, moved.ZoneNameId, moved.ZoneZipGroupId));
        var added = db.ZoneZips.Single(z => z.Zip == "07030");
        Assert.Equal((2, 2, 7, false), (added.ZoneNumber, added.ZoneNameId, added.ZoneZipGroupId, added.ApplyCongestion));
        // The ungrouped pricing row for the same ZIP is untouched.
        var pricing = db.ZoneZips.Single(z => z.ZoneZipId == 4);
        Assert.Equal((9, 2, (int?)null, true), (pricing.ZoneNumber, pricing.ZoneNameId, pricing.ZoneZipGroupId, pricing.ApplyCongestion));
    }

    [Fact]
    public async Task Us_a_zone_number_the_group_does_not_have_is_an_error_not_a_guess()
    {
        var (opts, conn) = SeedUs();
        using var _ = conn;
        var svc = Svc(opts, "US");
        var csv = Csv("1,64030,", "1,64031,", "2,65201,", "5,66002,");

        var preview = await svc.PreviewZoneGroupImportAsync(7, Req(csv, null));

        Assert.Contains(preview.Errors, e => e.StartsWith("Row 5:") && e.Contains("zone 5"));
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.ApplyZoneGroupImportAsync(7, Req(csv, preview.Token)));
        using var db = CockpitTestHarness.Context(opts);
        Assert.Equal(4, db.ZoneZips.Count());
    }

    [Fact]
    public async Task Us_an_added_zip_starts_with_last_modified_equal_to_created_like_a_single_create()
    {
        // Nit 1 / #980: CreateUsZipZoneAsync sets LastModified = Created, as
        // AdminManager does, and reports that sort by last change rely on it.
        var (opts, conn) = SeedUs();
        using var _ = conn;
        var svc = Svc(opts, "US");
        var csv = Csv("1,64030,", "1,64031,", "2,65201,", "2,65202,");

        var preview = await svc.PreviewZoneGroupImportAsync(7, Req(csv, null));
        await svc.ApplyZoneGroupImportAsync(7, Req(csv, preview.Token));

        using var db = CockpitTestHarness.Context(opts);
        var added = db.ZoneZips.Single(z => z.Zip == "65202");
        Assert.NotNull(added.LastModified);
        Assert.Equal(added.Created, added.LastModified);
        Assert.Equal("kevin@urgent.co.nz", added.LastModifiedBy);
    }

    [Fact]
    public async Task Us_a_zone_the_group_lacks_tells_the_user_to_add_its_first_zip_in_the_group_then_upload()
    {
        // Nit 4: a US ZIP takes its zone name from the group's own ZIPs in
        // that zone, so the file cannot start a zone. The message says what
        // to do instead of only what is wrong.
        var (opts, conn) = SeedUs();
        using var _ = conn;
        var svc = Svc(opts, "US");

        var preview = await svc.PreviewZoneGroupImportAsync(7, Req(Csv("1,64030,", "1,64031,", "2,65201,", "5,66002,"), null));

        Assert.Equal(
            "Row 5: zone 5 has no ZIPs in this group yet, so there is no zone name to put 66002 under. "
            + "Add zone 5's first ZIP in the group (Zones tab), then upload the file again.",
            Assert.Single(preview.Errors));
    }

    [Fact]
    public async Task Us_an_empty_group_cannot_be_filled_from_a_file_and_says_how_to_start_it()
    {
        // Nit 4: on an empty US group every row would repeat the per-zone
        // message, so the user gets one message naming the way in.
        var (opts, conn) = SeedUs();
        using var _ = conn;
        using (var db = CockpitTestHarness.Context(opts))
        {
            db.BulkZonePostcodeGroups.Add(new BulkZonePostcodeGroup { Id = 8, Name = "Empty", DepotId = 29 });
            db.SaveChanges();
        }
        var svc = Svc(opts, "US");

        var preview = await svc.PreviewZoneGroupImportAsync(8, Req(Csv("1,64030,", "2,65201,"), null));

        Assert.Equal(
            "This group has no ZIPs yet. A ZIP takes its zone name from the group's own ZIPs in that zone, "
            + "so add each zone's first ZIP in the group (Zones tab), then upload the file again.",
            Assert.Single(preview.Errors));
    }

    private static List<(int Id, string Zip, int? Zone, int? ZoneNameId, int? GroupId)> Zips(DbContextOptions<DespatchContext> opts)
    {
        using var db = CockpitTestHarness.Context(opts);
        return db.ZoneZips.AsNoTracking().OrderBy(z => z.ZoneZipId).ToList()
            .Select(z => (z.ZoneZipId, z.Zip, z.ZoneNumber, z.ZoneNameId, z.ZoneZipGroupId)).ToList();
    }

    [Fact]
    public async Task Us_a_zip_left_out_is_kept_without_the_tick_and_removed_only_from_the_group_with_it()
    {
        // Kevin 20 Nov: codes not in the file stay unless "Also remove" is
        // ticked. With the tick only the group's row goes; the ungrouped
        // pricing row for the same ZIP (id 4) is not the group's to delete.
        var (opts, conn) = SeedUs();
        using var _ = conn;
        var svc = Svc(opts, "US");
        var csv = Csv("1,64030,", "2,65201,");

        var preview = await svc.PreviewZoneGroupImportAsync(7, Req(csv, null));
        Assert.Equal("64031", Assert.Single(preview.Removed).Code);

        var kept = await svc.ApplyZoneGroupImportAsync(7, Req(csv, preview.Token, removeMissing: false));
        Assert.Equal((0, 0, 0, 1), (kept.Added, kept.Moved, kept.Removed, kept.KeptNotInFile));
        Assert.Equal(4, Zips(opts).Count);

        var again = await svc.PreviewZoneGroupImportAsync(7, Req(csv, null));
        var removed = await svc.ApplyZoneGroupImportAsync(7, Req(csv, again.Token, removeMissing: true));
        Assert.Equal(1, removed.Removed);
        var after = Zips(opts);
        Assert.DoesNotContain(after, z => z.Id == 2);
        Assert.Contains(after, z => z is { Id: 4, Zip: "64031", GroupId: null });
    }

    [Fact]
    public async Task Us_a_tenant_that_stores_a_zip_unpadded_refuses_the_upload_like_the_paste()
    {
        // Review M3: the paste stops on a tenant with a short ZIP spelling,
        // because padded and unpadded rows would put one ZIP in two zones.
        // The upload pads too, so it stops the same way.
        var (opts, conn) = SeedUs();
        using var _ = conn;
        using (var db = CockpitTestHarness.Context(opts))
        {
            db.ZoneZips.Add(new ZoneZip { ZoneZipId = 5, Zip = "7030", ZoneNumber = 3, ZoneNameId = 2, ApplyCongestion = false });
            db.SaveChanges();
        }
        var svc = Svc(opts, "US");
        var before = Zips(opts);
        var csv = Csv("1,64030,", "2,64031,", "2,65201,", "2,07030,");

        var preview = await svc.PreviewZoneGroupImportAsync(7, Req(csv, null));
        Assert.Contains(preview.Errors, e => e.Contains("unpadded") && e.Contains("\"7030\""));
        Assert.Empty(preview.Added);
        Assert.Empty(preview.Moved);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.ApplyZoneGroupImportAsync(7, Req(csv, preview.Token)));
        Assert.Contains("unpadded", ex.Message);
        Assert.Equal(before, Zips(opts));
    }

    [Fact]
    public async Task Us_an_add_to_a_zone_whose_rows_disagree_on_client_is_refused_not_guessed()
    {
        // Review M3: the add used to copy ClientId from whichever row came
        // first. Two clients in one zone has no single answer.
        var (opts, conn) = SeedUs();
        using var _ = conn;
        using (var db = CockpitTestHarness.Context(opts))
        {
            db.ZoneZips.Single(z => z.ZoneZipId == 1).ClientId = 10;
            db.ZoneZips.Single(z => z.ZoneZipId == 2).ClientId = 11;
            db.SaveChanges();
        }
        var svc = Svc(opts, "US");
        var before = Zips(opts);
        var csv = Csv("1,64030,", "1,64031,", "2,65201,", "1,64032,");

        var preview = await svc.PreviewZoneGroupImportAsync(7, Req(csv, null));
        var error = Assert.Single(preview.Errors);
        Assert.StartsWith("Row 5:", error);
        Assert.Contains("client", error);
        Assert.Contains("64032", error);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.ApplyZoneGroupImportAsync(7, Req(csv, preview.Token)));
        Assert.Equal(before, Zips(opts));
    }

    [Fact]
    public async Task Us_an_added_zip_takes_the_client_its_zone_agrees_on()
    {
        var (opts, conn) = SeedUs();
        using var _ = conn;
        using (var db = CockpitTestHarness.Context(opts))
        {
            db.ZoneZips.Single(z => z.ZoneZipId == 1).ClientId = 10;
            db.ZoneZips.Single(z => z.ZoneZipId == 2).ClientId = 10;
            db.SaveChanges();
        }
        var svc = Svc(opts, "US");
        var csv = Csv("1,64030,", "1,64031,", "2,65201,", "1,64032,");

        var preview = await svc.PreviewZoneGroupImportAsync(7, Req(csv, null));
        Assert.Empty(preview.Errors);
        await svc.ApplyZoneGroupImportAsync(7, Req(csv, preview.Token));

        using var read = CockpitTestHarness.Context(opts);
        var added = read.ZoneZips.Single(z => z.Zip == "64032");
        Assert.Equal((1, 1, 10, 7), (added.ZoneNumber, added.ZoneNameId, added.ClientId, added.ZoneZipGroupId));
    }

    [Theory]
    [InlineData("ABCDE")]
    [InlineData("640301")]
    public async Task Us_a_zip_that_is_not_one_to_five_digits_writes_nothing(string zip)
    {
        // ZG-REPORT: one non-numeric ZoneZip.Zip fails every US rate lookup
        // (Msg 245), so it must never be written.
        var (opts, conn) = SeedUs();
        using var _ = conn;
        var svc = Svc(opts, "US");
        var before = Zips(opts);
        var csv = Csv("1,64030,", "1,64031,", "2,65201,", $"2,{zip},");

        var preview = await svc.PreviewZoneGroupImportAsync(7, Req(csv, null));
        Assert.Equal($"Row 5: \"{zip}\" is not a ZIP.", Assert.Single(preview.Errors));
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.ApplyZoneGroupImportAsync(7, Req(csv, preview.Token)));
        Assert.Equal(before, Zips(opts));
    }

    // ─── controller ──────────────────────────────────────────────────────

    private sealed class SaveFails : SaveChangesInterceptor
    {
        public bool Armed { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (Armed)
                throw new DbUpdateException("An error occurred while saving the entity changes.",
                    new Exception("The INSERT permission was denied on the object 'BulkZonePostcode'."));
            return ValueTask.FromResult(result);
        }
    }

    [Fact]
    public async Task Apply_a_database_refusal_is_a_400_with_plain_words_and_a_messageId_not_a_500()
    {
        // Review m4: a missing grant on a tenant surfaced as a bare 500.
        var (baseOpts, conn) = SeedNz();
        using var _ = conn;
        var fail = new SaveFails();
        var opts = new DbContextOptionsBuilder<DespatchContext>(baseOpts).AddInterceptors(fail).Options;
        var svc = Svc(opts, "NZ");
        var ctl = new TerritoryController(svc, new PolygonBindingService(CockpitTestHarness.Factory(opts)));
        var before = GroupRows(baseOpts, 5);
        var csv = Csv("1,0110,Whangarei", "1,1011,Ponsonby", "2,1024,");
        var preview = await svc.PreviewZoneGroupImportAsync(5, Req(csv, null));

        fail.Armed = true;
        var result = await ctl.ApplyZoneGroupImport(5, Req(csv, preview.Token));

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var body = bad.Value!;
        var message = (string)body.GetType().GetProperty("message")!.GetValue(body)!;
        var messageId = body.GetType().GetProperty("messageId")?.GetValue(body);
        Assert.StartsWith("Nothing was saved.", message);
        Assert.DoesNotContain("permission", message);
        Assert.IsType<Guid>(messageId);
        Assert.Equal(before, GroupRows(baseOpts, 5));
    }

    // ─── round 2 review (20 Nov) ─────────────────────────────────────────

    private static object Prop(object body, string name) => body.GetType().GetProperty(name)?.GetValue(body);

    private static TerritoryController Ctl(TerritoryService svc, DbContextOptions<DespatchContext> opts) =>
        new(svc, new PolygonBindingService(CockpitTestHarness.Factory(opts)));

    [Fact]
    public async Task A_stale_apply_carries_the_stale_code_and_other_refusals_do_not()
    {
        // r3: the panel re-previews only on a stale token. A file error or a
        // database refusal must not tell the operator "the preview below now
        // shows the group as it is" when nothing about the group changed.
        var (opts, conn) = SeedNz();
        using var _ = conn;
        var svc = Svc(opts, "NZ");
        var ctl = Ctl(svc, opts);
        var csv = Csv("1,0110,Whangarei", "1,1011,Ponsonby", "2,1024,");
        var preview = await svc.PreviewZoneGroupImportAsync(5, Req(csv, null));
        using (var db = CockpitTestHarness.Context(opts))
        {
            db.BulkZonePostcodes.Single(p => p.Id == 12).Zone = 4;
            db.SaveChanges();
        }

        var stale = Assert.IsType<BadRequestObjectResult>(await ctl.ApplyZoneGroupImport(5, Req(csv, preview.Token))).Value!;
        Assert.Equal("stale", Prop(stale, "code"));
        Assert.IsType<Guid>(Prop(stale, "messageId"));

        var fresh = await svc.PreviewZoneGroupImportAsync(5, Req(csv, null));
        var badFile = Csv("x,0110,Whangarei");
        var refused = Assert.IsType<BadRequestObjectResult>(await ctl.ApplyZoneGroupImport(5, Req(badFile, fresh.Token))).Value!;
        Assert.Null(Prop(refused, "code"));
        Assert.Contains("Row 2:", (string)Prop(refused, "message"));
    }

    private sealed class ReadFails : DbCommandInterceptor
    {
        public bool Armed { get; set; }

        public override ValueTask<InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
            System.Data.Common.DbCommand command, CommandEventData eventData,
            InterceptionResult<System.Data.Common.DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (Armed && command.CommandText.Contains("\"BulkZonePostcode\""))
                throw new Microsoft.Data.Sqlite.SqliteException("The SELECT permission was denied on the object 'BulkZonePostcode'.", 229);
            return ValueTask.FromResult(result);
        }
    }

    [Fact]
    public async Task A_database_error_on_a_read_is_a_400_with_plain_words_and_a_messageId_not_a_500()
    {
        // r4: a SqlException from a read (a missing SELECT grant on Cheetah
        // or OTG, both unverified) is neither InvalidOperationException nor
        // DbUpdateException, so it escaped as "HTTP 500 at ...".
        var (baseOpts, conn) = SeedNz();
        using var _ = conn;
        var fail = new ReadFails();
        var opts = new DbContextOptionsBuilder<DespatchContext>(baseOpts).AddInterceptors(fail).Options;
        var svc = Svc(opts, "NZ");
        var ctl = Ctl(svc, opts);
        var csv = Csv("1,0110,Whangarei", "1,1011,Ponsonby", "2,1024,");
        var token = (await svc.PreviewZoneGroupImportAsync(5, Req(csv, null))).Token;

        fail.Armed = true;
        // Nit 2: a preview only reads, so "Nothing was saved" would suggest
        // the operator had tried to save. The apply keeps the save wording.
        foreach (var (result, opening) in new[]
                 {
                     (await ctl.PreviewZoneGroupImport(5, Req(csv, null)), "The group could not be read."),
                     (await ctl.ApplyZoneGroupImport(5, Req(csv, token)), "Nothing was saved."),
                 })
        {
            var body = Assert.IsType<BadRequestObjectResult>(result).Value!;
            var message = (string)Prop(body, "message");
            Assert.StartsWith(opening, message);
            Assert.DoesNotContain("permission", message);
            Assert.IsType<Guid>(Prop(body, "messageId"));
        }
        Assert.Equal(new[] { (11, 110, 1), (12, 1024, 2), (13, 1011, 2) }, GroupRows(baseOpts, 5));
    }

    [Fact]
    public async Task An_empty_upload_reaches_the_action_so_it_is_logged_and_answered_in_plain_words()
    {
        // n-a: [Required] on Csv made [ApiController] reject an empty file
        // before WrapLogged ran, so the request was never logged under a
        // MessageId. The parser already refuses an empty file by name.
        var req = new ZoneGroupImportRequest { Csv = "" };
        Assert.True(System.ComponentModel.DataAnnotations.Validator.TryValidateObject(
            req, new System.ComponentModel.DataAnnotations.ValidationContext(req), null, validateAllProperties: true));

        var (opts, conn) = SeedNz();
        using var _ = conn;
        var ok = Assert.IsType<OkObjectResult>(await Ctl(Svc(opts, "NZ"), opts).PreviewZoneGroupImport(5, req));
        var preview = Assert.IsType<ZoneGroupCsvImport.ZoneGroupImportPreview>(Prop(ok.Value!, "response"));
        Assert.StartsWith("Row 1:", Assert.Single(preview.Errors));
    }

    [Fact]
    public async Task Us_a_zip_stored_with_no_zone_round_trips_as_unchanged()
    {
        // r1 end to end: the detail shows a NULL ZoneNumber as zone 0, the
        // export writes it blank, and the upload of that file is no change.
        var (opts, conn) = SeedUs();
        using var _ = conn;
        using (var db = CockpitTestHarness.Context(opts))
        {
            db.ZoneZips.Add(new ZoneZip { ZoneZipId = 6, Zip = "64040", ZoneNumber = null, ZoneNameId = 1, ZoneZipGroupId = 7, ApplyCongestion = false });
            db.SaveChanges();
        }
        var svc = Svc(opts, "US");
        var csv = Csv("1,64030,", "1,64031,", "2,65201,", ",64040,", "2,65202,");

        var preview = await svc.PreviewZoneGroupImportAsync(7, Req(csv, null));
        Assert.Empty(preview.Errors);
        Assert.Equal(4, preview.Unchanged);
        Assert.Equal("65202", Assert.Single(preview.Added).Code);

        await svc.ApplyZoneGroupImportAsync(7, Req(csv, preview.Token));
        Assert.Contains(Zips(opts), z => z is { Id: 6, Zone: null });
    }

    [Fact]
    public async Task A_group_holding_a_junk_zip_can_be_reuploaded_keeping_it_or_dropping_it_with_the_tick()
    {
        // FIX-REPORT: "ABQ Test Zone" holds 8-digit ZIPs. Re-stating one
        // unchanged is fine; leaving it out is "not in the file", and only
        // the tick deletes it.
        var (opts, conn) = SeedUs();
        using var _ = conn;
        using (var db = CockpitTestHarness.Context(opts))
        {
            db.ZoneZips.Add(new ZoneZip { ZoneZipId = 6, Zip = "99895077", ZoneNumber = 1, ZoneNameId = 1, ZoneZipGroupId = 7, ApplyCongestion = false });
            db.SaveChanges();
        }
        var svc = Svc(opts, "US");

        var keep = Csv("1,64030,", "1,64031,", "2,65201,", "1,99895077,", "1,64032,");
        var p1 = await svc.PreviewZoneGroupImportAsync(7, Req(keep, null));
        Assert.Empty(p1.Errors);
        await svc.ApplyZoneGroupImportAsync(7, Req(keep, p1.Token));
        Assert.Contains(Zips(opts), z => z is { Id: 6, Zip: "99895077" });
        Assert.Contains(Zips(opts), z => z.Zip == "64032");

        var drop = Csv("1,64030,", "1,64031,", "2,65201,", "1,64032,");
        var p2 = await svc.PreviewZoneGroupImportAsync(7, Req(drop, null));
        Assert.Empty(p2.Errors);
        Assert.Equal("99895077", Assert.Single(p2.Removed).Code);
        var r = await svc.ApplyZoneGroupImportAsync(7, Req(drop, p2.Token, removeMissing: true));
        Assert.Equal(1, r.Removed);
        Assert.DoesNotContain(Zips(opts), z => z.Id == 6);
    }

    /// <summary>Records whether each command touching the member tables ran
    /// inside a transaction the service opened.</summary>
    private sealed class TxRecorder : DbCommandInterceptor
    {
        public List<(string Sql, bool InTx)> Seen { get; } = new();

        private void Note(System.Data.Common.DbCommand c)
        {
            if (c.CommandText.Contains("\"BulkZonePostcode\"") || c.CommandText.Contains("\"ZoneZip\""))
                Seen.Add((c.CommandText, c.Transaction != null));
        }

        public override ValueTask<InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
            System.Data.Common.DbCommand command, CommandEventData eventData,
            InterceptionResult<System.Data.Common.DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Note(command);
            return ValueTask.FromResult(result);
        }
    }

    [Fact]
    public async Task Writers_of_a_groups_members_read_and_write_inside_one_transaction()
    {
        // r2: the apply locks the group row (UPDLOCK on BulkZonePostcodeGroup)
        // inside its transaction. The paste and the single-row editors must
        // take the same lock in the same shape, so they queue behind an
        // apply instead of landing between its token check and its commit.
        // SQLite skips the lock hint, so what is pinned here is the shape:
        // the reads that decide the write are in the write's transaction.
        var (baseOpts, conn) = SeedNz();
        using var _ = conn;
        var rec = new TxRecorder();
        var opts = new DbContextOptionsBuilder<DespatchContext>(baseOpts).AddInterceptors(rec).Options;
        var svc = Svc(opts, "NZ");

        await svc.PasteNzPostcodesAsync(5, 3, new NzPostcodePasteRequest { Postcodes = new() { "1010", "0110" } });
        await svc.UpdateNzPostcodeAsync(12, new NzPostcodeUpsertRequest { PostCode = 1024, Zone = 3, DepotId = 3, PostcodeGroupId = 6, Name = "Mt Eden, Auckland" });
        await svc.DeleteNzPostcodeAsync(13);

        Assert.NotEmpty(rec.Seen);
        Assert.All(rec.Seen, s => Assert.True(s.InTx, "outside a transaction: " + s.Sql));
    }

    [Fact]
    public async Task Us_single_row_editors_of_a_groups_zips_run_inside_one_transaction()
    {
        // r2, US side: ZoneZip rows carry ZoneZipGroupId, so the US editors
        // can change a group's members too.
        var (baseOpts, conn) = SeedUs();
        using var _ = conn;
        var rec = new TxRecorder();
        var opts = new DbContextOptionsBuilder<DespatchContext>(baseOpts).AddInterceptors(rec).Options;
        var svc = Svc(opts, "US");

        await svc.UpdateUsZipZoneAsync(2, new UsZipZoneUpsertRequest { Zip = "64031", ZoneNumber = 2, ZoneNameId = 2, ZoneZipGroupId = 7, ApplyCongestion = false });
        await svc.DeleteUsZipZoneAsync(3);

        Assert.NotEmpty(rec.Seen);
        Assert.All(rec.Seen, s => Assert.True(s.InTx, "outside a transaction: " + s.Sql));
    }
}
