using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.Schedule;
using RoutedOperations.Core.Application.Services.Schedule;
using RoutedOperations.Core.Application.Utilities;

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

    private static ScheduleGroupUpsertRequest ValidRequest() => new()
    {
        Name = "Test Group",
        RegionId = 1,
        DayWindows = new List<DayWindowUpsertRequest>
        {
            new() { DayOfWeek = 1, StartTime = "08:00", EndTime = "17:00", CutoffHours = 2 },
            new() { DayOfWeek = 2, StartTime = "08:00", EndTime = "17:00", CutoffHours = 2 },
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
        req.DayWindows.Add(new DayWindowUpsertRequest { DayOfWeek = 1, StartTime = "10:00", EndTime = "12:00", CutoffHours = 0 });
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
            new() { DayOfWeek = 1, StartTime = "08:00", EndTime = "17:00", CutoffHours = 2 },
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
    public async Task UpsertAsync_syncs_postcode_and_polygon_junctions()
    {
        var svc = NewSvc();
        var req = ValidRequest();
        req.PostcodeIds = new List<int> { 1010, 6011 };
        req.PolygonIds = new List<int> { 500, 501 };
        var created = await svc.UpsertAsync(req);
        Assert.Equal(new[] { 1010, 6011 }, created.PostcodeIds.ToArray());
        Assert.Equal(new[] { 500, 501 }, created.PolygonIds.ToArray());
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
        // Junctions copied.
        Assert.Contains(1010, copy.PostcodeIds);
        Assert.Contains(500, copy.PolygonIds);
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
}
