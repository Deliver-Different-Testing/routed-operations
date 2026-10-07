using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.Schedule;
using RoutedOperations.Core.Application.Services.Schedule;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Schedule;

/// <summary>
/// Covers the write-path rules on the new group-shaped ScheduleService:
///   * ValidateUpsert (name / region / day-window required, duplicate
///     day-of-week rejected, dayOfWeek range 1-7)
///   * ValidateLinehauls (name required, from-depot required unless
///     from-client-address, to-depot required, at least one active day)
///   * Day-window sync: create adds N tblBulkRunSchedule rows;
///     update-with-fewer-days removes the missing days; auto-book
///     toggle flips every row in the group
///   * Junction sync: ClientIds / PostcodeIds / PolygonIds are
///     insert-and-delete-diffed on save
/// </summary>
public class ScheduleServiceTests
{
    private static ScheduleService NewSvc()
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        var cache = new TenantScopedCache(
            new MemoryCache(new MemoryCacheOptions()),
            new HttpContextAccessor());
        return new ScheduleService(
            CockpitTestHarness.Factory(opts),
            NullLogger<ScheduleService>.Instance,
            cache);
    }

    /// <summary>Constructs the service AND hands back the shared
    /// DbContextOptions + a seed context so tests that need to plant
    /// header + client + day-row + override rows before calling the
    /// service can do so directly (mirrors ScheduleOverrideServiceTests'
    /// NewSvc(out ..., out ...) pattern).</summary>
    private static ScheduleService NewSvcWithSeed(
        out DynamicDespatchDbContext seed,
        out DbContextOptions<DespatchContext> opts)
    {
        opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var cache = new TenantScopedCache(
            new MemoryCache(new MemoryCacheOptions()),
            new HttpContextAccessor());
        return new ScheduleService(
            CockpitTestHarness.Factory(opts),
            NullLogger<ScheduleService>.Instance,
            cache);
    }

    private static ScheduleGroupUpsertRequest ValidRequest() => new()
    {
        Name = "Test Group",
        RegionId = 1,
        DayWindows = new List<DayWindowUpsertRequest>
        {
            // F11 Phase C (2026-09-24): absolute cutoff pair replaces the
            // integer CutoffHours field. Same-day 15:00 approximates a
            // 2h-before-17:00-close cutoff.
            new() { DayOfWeek = 1, StartTime = "08:00", EndTime = "17:00", CutoffDay = 1, CutoffTime = "15:00" },
            new() { DayOfWeek = 2, StartTime = "08:00", EndTime = "17:00", CutoffDay = 2, CutoffTime = "15:00" },
        },
        Zones = new List<ScheduleZoneUpsertRequest>
        {
            new() { Zone = 1, Active = true },
            new() { Zone = 2, Active = false },
        },
        Linehauls = new List<ScheduleLinehaulUpsertRequest>(),
    };

    [Fact]
    public async Task UpsertAsync_missing_name_is_rejected()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.Name = " ";
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(req));
        Assert.Contains("name is required", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UpsertAsync_missing_region_is_rejected()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.RegionId = 0;
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(req));
        Assert.Contains("Destination depot", ex.Message);
    }

    [Fact]
    public async Task UpsertAsync_no_day_windows_is_rejected()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.DayWindows.Clear();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(req));
        Assert.Contains("day-window is required", ex.Message);
    }

    [Fact]
    public async Task UpsertAsync_duplicate_day_of_week_is_rejected()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.DayWindows.Add(new DayWindowUpsertRequest { DayOfWeek = 1, StartTime = "10:00", EndTime = "12:00", CutoffDay = null, CutoffTime = null });
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(req));
        Assert.Contains("Duplicate day-window", ex.Message);
    }

    [Fact]
    public async Task UpsertAsync_day_of_week_out_of_range_is_rejected()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.DayWindows[0].DayOfWeek = 0;
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(req));
        Assert.Contains("DayOfWeek must be 1-7", ex.Message);
    }

    [Fact]
    public async Task UpsertAsync_linehaul_missing_name_is_rejected()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.Linehauls.Add(new ScheduleLinehaulUpsertRequest
        {
            FromDepotId = 1, ToDepotId = 2,
            WeekDay = new[] { 1, 0, 0, 0, 0, 0, 0 },
        });
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(req));
        Assert.Contains("Name is required", ex.Message);
    }

    [Fact]
    public async Task UpsertAsync_linehaul_missing_from_depot_is_rejected_unless_from_client_address()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.Linehauls.Add(new ScheduleLinehaulUpsertRequest
        {
            Name = "Leg1", FromDepotId = null, FromClientAddress = false,
            ToDepotId = 2, WeekDay = new[] { 1, 0, 0, 0, 0, 0, 0 },
        });
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(req));
        Assert.Contains("From Depot is required", ex.Message);
    }

    [Fact]
    public async Task UpsertAsync_linehaul_from_client_address_bypasses_from_depot_check()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.Linehauls.Add(new ScheduleLinehaulUpsertRequest
        {
            Name = "Leg1", FromClientAddress = true, FromDepotId = null,
            ToDepotId = null, // this one triggers the next check
            WeekDay = new[] { 1, 0, 0, 0, 0, 0, 0 },
        });
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(req));
        Assert.Contains("To Depot is required", ex.Message);
    }

    [Fact]
    public async Task UpsertAsync_linehaul_no_active_day_is_rejected()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.Linehauls.Add(new ScheduleLinehaulUpsertRequest
        {
            Name = "Leg1", FromDepotId = 1, ToDepotId = 2,
            WeekDay = new[] { 0, 0, 0, 0, 0, 0, 0 },
        });
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(req));
        Assert.Contains("at least one active day", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UpsertAsync_creates_one_row_per_day_window_and_returns_hydrated_group()
    {
        var svc = NewSvc();
        var req = ValidRequest();

        var result = await svc.UpsertAsync(req);

        Assert.Equal("Test Group", result.Name);
        Assert.Null(result.LegacyClientId);
        Assert.Equal(2, result.DayWindows.Count);
        Assert.Contains(result.DayWindows, w => w.DayOfWeek == 1);
        Assert.Contains(result.DayWindows, w => w.DayOfWeek == 2);
        Assert.Equal(2, result.Zones.Count);
    }

    [Fact]
    public async Task UpsertAsync_update_removes_day_windows_not_in_the_request()
    {
        var svc = NewSvc();
        var first = ValidRequest();
        await svc.UpsertAsync(first);

        var second = ValidRequest();
        second.DayWindows = new List<DayWindowUpsertRequest>
        {
            new() { DayOfWeek = 1, StartTime = "08:00", EndTime = "17:00", CutoffDay = 1, CutoffTime = "15:00" },
            // Day 2 removed
        };
        var result = await svc.UpsertAsync(second);
        Assert.Single(result.DayWindows);
        Assert.Equal(1, result.DayWindows[0].DayOfWeek);
    }

    [Fact]
    public async Task UpsertAsync_syncs_client_junction()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.ClientIds = new List<int> { 100, 200, 300 };
        var created = await svc.UpsertAsync(req);
        Assert.Equal(new[] { 100, 200, 300 }, created.ClientIds.ToArray());

        // Remove 200, add 400.
        req.ClientIds = new List<int> { 100, 300, 400 };
        var updated = await svc.UpsertAsync(req);
        Assert.Equal(new[] { 100, 300, 400 }, updated.ClientIds.ToArray());
    }

    [Fact]
    public async Task UpsertAsync_syncs_postcodes_but_no_longer_writes_polygon_junction()
    {
        // tblSchedulePolygon is retired (custom-polygons spec 3.4). A polygon
        // attached to a SCHEDULE never affected booking - no stored procedure
        // read that junction - so PolygonIds on the request is now ignored and
        // PolygonIds on the response is derived from the schedule's ZONE
        // memberships instead. This schedule has none, so it reads empty.
        //
        // The postcode junction is untouched and still round-trips, which is
        // what keeps this test honest: a blanket "both are empty" would pass
        // even if the postcode sync had broken too.
        var svc = NewSvc();
        var req = ValidRequest();
        req.PostcodeIds = new List<int> { 1010, 6011 };
        req.PolygonIds = new List<int> { 500, 501 };
        var created = await svc.UpsertAsync(req);
        Assert.Equal(new[] { 1010, 6011 }, created.PostcodeIds.ToArray());
        Assert.Empty(created.PolygonIds);
    }

    [Fact]
    public async Task ToggleAutoBookAsync_flips_every_row_in_the_group()
    {
        var svc = NewSvc();
        await svc.UpsertAsync(ValidRequest());

        var after1 = await svc.ToggleAutoBookAsync("Test Group", null);
        Assert.True(after1);
        var after2 = await svc.ToggleAutoBookAsync("Test Group", null);
        Assert.False(after2);
    }

    [Fact]
    public async Task CopyAsync_creates_new_group_with_all_day_windows()
    {
        var svc = NewSvc();
        var src = ValidRequest();
        src.Name = "Source";
        src.ClientIds = new List<int> { 100 };
        src.PostcodeIds = new List<int> { 1010 };
        src.PolygonIds = new List<int> { 500 };
        await svc.UpsertAsync(src);

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceName = "Source", SourceLegacyClientId = null,
            NewName = "Source (copy)",
            ClientCodes = new List<string>(), // inherit source's clients
            ClientIds = new List<int>(),
        });

        Assert.Equal("Source (copy)", copy.Name);
        Assert.Null(copy.LegacyClientId);
        Assert.Equal(2, copy.DayWindows.Count);
        // Postcode junction still copies.
        Assert.Contains(1010, copy.PostcodeIds);
        // The polygon junction is retired (spec 3.4); a copy's polygon
        // coverage comes from its zone groups, not from a copied junction.
        Assert.Empty(copy.PolygonIds);
        // Client bindings inherited from source's junction.
        Assert.Contains(100, copy.ClientIds);
    }

    [Fact]
    public async Task CopyAsync_rejects_same_name_when_source_is_default()
    {
        var svc = NewSvc();
        var src = ValidRequest();
        src.Name = "Source";
        await svc.UpsertAsync(src);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.CopyAsync(new ScheduleCopyRequest
            {
                SourceName = "Source", SourceLegacyClientId = null,
                NewName = "Source", // same!
            }));
        Assert.Contains("New name must differ", ex.Message);
    }

    [Fact]
    public async Task CopyAsync_rejects_when_target_name_already_exists()
    {
        var svc = NewSvc();
        var a = ValidRequest(); a.Name = "A"; await svc.UpsertAsync(a);
        var b = ValidRequest(); b.Name = "B"; await svc.UpsertAsync(b);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.CopyAsync(new ScheduleCopyRequest { SourceName = "A", NewName = "B" }));
        Assert.Contains("already exists", ex.Message);
    }

    [Fact]
    public async Task CopyAsync_source_not_found_throws()
    {
        var svc = NewSvc();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.CopyAsync(new ScheduleCopyRequest { SourceName = "Ghost", NewName = "Ghost (copy)" }));
        Assert.Contains("not found", ex.Message);
    }

    [Fact]
    public async Task CopyAsync_client_ids_override_replaces_source_junction()
    {
        var svc = NewSvc();
        var src = ValidRequest();
        src.Name = "Source";
        src.ClientIds = new List<int> { 100, 200 };
        await svc.UpsertAsync(src);

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceName = "Source", NewName = "Source (copy)",
            ClientIds = new List<int> { 300, 400 }, // explicit override
        });

        Assert.Equal(new[] { 300, 400 }, copy.ClientIds.ToArray());
    }

    [Fact]
    public async Task CopyAsync_with_CopyClientLinks_false_creates_no_client_links()
    {
        // Regression guard for the 2026-10-05 defect: POST /api/v2/schedules/{id}/copy
        // sends an empty ClientIds and its modal promises "Client link rows are NOT
        // copied", but the resolver's fall-through inherited the source's junction, so
        // copying a 40-client schedule produced a second 40-client schedule. The empty
        // list cannot carry that intent on its own because the legacy endpoint relies
        // on the same emptiness to mean "inherit", so the caller states it explicitly.
        var svc = NewSvc();
        var src = ValidRequest();
        src.Name = "Source";
        src.ClientIds = new List<int> { 100, 200 };
        await svc.UpsertAsync(src);

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceName = "Source", NewName = "Source (copy)",
            ClientCodes = new List<string>(),
            ClientIds = new List<int>(),
            CopyClientLinks = false,
        });

        Assert.Empty(copy.ClientIds);

        // The source keeps its own clients - this is a copy, not a move.
        var reread = await svc.GetDetailAsync("Source", null);
        Assert.Equal(new[] { 100, 200 }, reread.ClientIds.OrderBy(x => x).ToArray());
    }

    [Fact]
    public async Task DeleteAsync_removes_group_and_junctions()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.ClientIds = new List<int> { 1 };
        req.PostcodeIds = new List<int> { 1010 };
        await svc.UpsertAsync(req);

        await svc.DeleteAsync("Test Group", null);

        var remaining = await svc.GetAsync(clientId: null);
        Assert.DoesNotContain(remaining, g => g.Name == "Test Group");
    }

    [Fact]
    public async Task ListSummaryAsync_populates_overrides_row_per_client_with_delta_labels()
    {
        // Steve nested-override brief (2026-09-24): each base schedule row
        // in the Schedules NEW list carries its per-client delta rows so
        // the frontend can render nested <tr>s under the base. Base row
        // sets CutoffDay=Fri (5) / CutoffTime=15:00; two clients each own
        // a schedule-scope override that changes CutoffTime to a
        // different value. Expect one override row per client, each with
        // one DeltaLabel matching the "Cut-off Fri HH:mm (base Fri 15:00)"
        // format the backend produces.
        const int ScheduleId = 42;
        const int ClientA = 100;
        const int ClientB = 200;
        var svc = NewSvcWithSeed(out var seed, out var opts);
        seed.BulkRunScheduleHeaders.Add(new BulkRunScheduleHeader
        {
            ScheduleId = ScheduleId,
            Name = "Nested Test",
            IsDefault = true,
            IsActive = true,
            OverrideCount = 2,
            CreatedUtc = DateTime.UtcNow,
            CreatedBy = "seed",
        });
        seed.TblBulkRunSchedules.Add(new TblBulkRunSchedule
        {
            Name = "Nested Test",
            ScheduleId = ScheduleId,
            DayOfWeek = 5,
            StartTime = TimeSpan.Parse("08:00"),
            EndTime = TimeSpan.Parse("17:00"),
            CutoffDay = 5,
            CutoffTime = TimeSpan.Parse("15:00"),
            Region = 1,
            MaxJobs = 10000,
        });
        seed.TucClients.Add(new TucClient { UcclId = ClientA, UcclCode = "AAA", UcclName = "Client A" });
        seed.TucClients.Add(new TucClient { UcclId = ClientB, UcclCode = "BBB", UcclName = "Client B" });
        seed.BulkRunScheduleOverrides.Add(new BulkRunScheduleOverride
        {
            ScheduleId = ScheduleId,
            ClientId = ClientA,
            Scope = BulkRunScheduleOverride.ScopeSchedule,
            CutoffDay = 5,
            CutoffTime = TimeSpan.Parse("14:00"),
            CreatedUtc = DateTime.UtcNow,
            CreatedBy = "seed",
        });
        seed.BulkRunScheduleOverrides.Add(new BulkRunScheduleOverride
        {
            ScheduleId = ScheduleId,
            ClientId = ClientB,
            Scope = BulkRunScheduleOverride.ScopeSchedule,
            CutoffDay = 5,
            CutoffTime = TimeSpan.Parse("13:00"),
            CreatedUtc = DateTime.UtcNow,
            CreatedBy = "seed",
        });
        await seed.SaveChangesAsync();

        var summaries = await svc.ListSummaryAsync(
            clientId: null, includeClientSpecific: false, includeAllLive: true);

        var summary = Assert.Single(summaries.Where(s => s.ScheduleId == ScheduleId));
        Assert.Equal(2, summary.Overrides.Count);
        // Sorted alphabetically by client code so the assertion order is
        // stable regardless of override-row insertion order.
        var overrides = summary.Overrides.OrderBy(o => o.ClientCode).ToList();
        Assert.Equal(ClientA, overrides[0].ClientId);
        Assert.Equal("AAA", overrides[0].ClientCode);
        Assert.Equal("Client A", overrides[0].ClientName);
        Assert.Single(overrides[0].DeltaLabels);
        Assert.Equal("Cut-off Fri 14:00 (base Fri 15:00)", overrides[0].DeltaLabels[0]);
        Assert.Equal(ClientB, overrides[1].ClientId);
        Assert.Equal("BBB", overrides[1].ClientCode);
        Assert.Single(overrides[1].DeltaLabels);
        Assert.Equal("Cut-off Fri 13:00 (base Fri 15:00)", overrides[1].DeltaLabels[0]);
    }

    // ── LegOrder (Bug 1, Steve "Linehaul Leg Fixes" 2026-09-25) ────────────
    //
    // Why these matter rather than just asserting a field round-trips:
    // tblBulkScheduleLinehaul.LegOrder is what DD_/WS_stpBulkScheduleJob_
    // InsertChildJobs walk to number the legs LH1..LHn and, on the US branch,
    // to time each hop. Before it existed those SPs ordered by clustered Id,
    // i.e. the order the legs were first typed in, and hops were being
    // dispatched before the freight reached them (Steve's NEOGE P4206 had the
    // Burbank hop scheduled four hours before the flight landed).
    //
    // The save path does a RemoveRange + re-add, so every leg gets a fresh
    // identity Id. If the order is not written back on save, the backfilled
    // values are wiped and the schedule silently regresses to Id order. That
    // is the failure these tests exist to catch.

    private static ScheduleLinehaulUpsertRequest Leg(string name, int from, int to, int? legOrder = null) => new()
    {
        Name = name,
        FromDepotId = from,
        ToDepotId = to,
        WeekDay = new[] { 1, 0, 0, 0, 0, 0, 0 },
        LegOrder = legOrder,
    };

    [Fact]
    public async Task UpsertAsync_assigns_LegOrder_from_request_position_when_the_caller_omits_it()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        // Names deliberately in the opposite order to travel order, so a Name
        // sort anywhere in the read path would fail this test.
        req.Linehauls.Add(Leg("Zulu leg", 1, 2));
        req.Linehauls.Add(Leg("Yankee leg", 2, 3));
        req.Linehauls.Add(Leg("Xray leg", 3, 4));

        var result = await svc.UpsertAsync(req);

        Assert.Equal(new int?[] { 1, 2, 3 }, result.Linehauls.Select(l => l.LegOrder).ToArray());
        Assert.Equal(
            new[] { "Zulu leg", "Yankee leg", "Xray leg" },
            result.Linehauls.Select(l => l.Name).ToArray());
    }

    [Fact]
    public async Task UpsertAsync_explicit_LegOrder_wins_over_the_request_position()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        // Sent in the wrong order on purpose, with the true travel order
        // declared explicitly. A client that reorders its own array and a
        // client that sends LegOrder must both end up with the same chain.
        req.Linehauls.Add(Leg("second hop", 2, 3, legOrder: 2));
        req.Linehauls.Add(Leg("first hop", 1, 2, legOrder: 1));

        var result = await svc.UpsertAsync(req);

        Assert.Equal(new int?[] { 1, 2 }, result.Linehauls.Select(l => l.LegOrder).ToArray());
        Assert.Equal(
            new[] { "first hop", "second hop" },
            result.Linehauls.Select(l => l.Name).ToArray());
    }

    [Fact]
    public async Task UpsertAsync_resave_preserves_travel_order_instead_of_wiping_it()
    {
        // The regression this whole change exists for. The save path removes and
        // re-adds every linehaul row, so a resave used to hand the legs back in
        // fresh-Id order with no travel order at all.
        var svc = NewSvc();
        var first = ValidRequest();
        first.Linehauls.Add(Leg("Zulu leg", 1, 2));
        first.Linehauls.Add(Leg("Alpha leg", 2, 3));
        var created = await svc.UpsertAsync(first);
        Assert.Equal(new int?[] { 1, 2 }, created.Linehauls.Select(l => l.LegOrder).ToArray());

        // Post the legs back exactly as the editor received them.
        var second = ValidRequest();
        foreach (var l in created.Linehauls)
            second.Linehauls.Add(Leg(l.Name, l.FromDepotId ?? 0, l.ToDepotId ?? 0, l.LegOrder));

        var resaved = await svc.UpsertAsync(second);

        Assert.Equal(new int?[] { 1, 2 }, resaved.Linehauls.Select(l => l.LegOrder).ToArray());
        Assert.Equal(
            new[] { "Zulu leg", "Alpha leg" },
            resaved.Linehauls.Select(l => l.Name).ToArray());
    }

    [Fact]
    public async Task CopyAsync_carries_LegOrder_and_SpeedId_onto_the_copy()
    {
        // SpeedId was missing from the copy initialiser since the per-leg
        // override shipped 2026-06-19, so copying a schedule silently dropped
        // every leg's service class and the copy re-rated off the run speed.
        // LegOrder would have had the same problem from day one.
        var svc = NewSvc();
        var req = ValidRequest();
        req.Linehauls.Add(Leg("Zulu leg", 1, 2));
        req.Linehauls.Add(Leg("Alpha leg", 2, 3));
        req.Linehauls[0].SpeedId = 77;
        var source = await svc.UpsertAsync(req);

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceScheduleId = source.ScheduleId,
            NewName = "Copied Group",
        });

        Assert.Equal(new int?[] { 1, 2 }, copy.Linehauls.Select(l => l.LegOrder).ToArray());
        Assert.Equal("Zulu leg", copy.Linehauls[0].Name);
        Assert.Equal(77, copy.Linehauls[0].SpeedId);
        Assert.Null(copy.Linehauls[1].SpeedId);
    }
}
