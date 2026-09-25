using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.Schedule;
using RoutedOperations.Core.Application.Services.Schedule;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Schedule;

/// <summary>
/// Covers the write + read path on ScheduleOverrideService (Steve F1
/// client-override delta model, 2026-09-22). Owns per-client delta rows on
/// tblBulkRunScheduleOverride + maintenance of the Header.OverrideCount
/// counter that lets booking-path callers skip the override table when a
/// schedule carries no deltas.
///
/// Uses EF InMemory via CockpitTestHarness. The service is pure LINQ (no
/// SqlQueryRaw / ExecuteSqlRawAsync) so the InMemory provider reflects
/// production shape faithfully. The DB-level CK constraints (scope fields
/// mutual-exclusion, NotEmpty) are not exercised here on purpose: they are
/// belt-and-braces guards, and the service's Build* helpers enforce the
/// same rules at the C# layer before ever calling SaveChangesAsync.
/// </summary>
public class ScheduleOverrideServiceTests
{
    private const int HeaderA = 1001;
    private const int HeaderB = 1002;
    private const int HeaderC = 1003;
    private const int ClientA = 100;
    private const int ClientB = 200;
    private const int ClientC = 300;
    private const string Actor = "kevin@test";

    private static ScheduleOverrideService NewSvc(
        out DynamicDespatchDbContext seed,
        out DbContextOptions<DespatchContext> opts)
    {
        opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        return new ScheduleOverrideService(
            CockpitTestHarness.Factory(opts),
            NullLogger<ScheduleOverrideService>.Instance);
    }

    private static BulkRunScheduleHeader NewHeader(int id, string name = null) => new()
    {
        ScheduleId = id,
        Name = name ?? $"Schedule-{id}",
        IsDefault = false,
        IsActive = true,
        OverrideCount = 0,
        CreatedUtc = DateTime.UtcNow,
        CreatedBy = "seed",
    };

    private static TucClient NewClient(int id) => new()
    {
        UcclId = id,
        UcclCode = $"C{id}",
        UcclName = $"Client {id}",
    };

    private static async Task SeedAsync(
        DynamicDespatchDbContext seed,
        int[] headerIds,
        int[] clientIds)
    {
        foreach (var h in headerIds)
        {
            seed.BulkRunScheduleHeaders.Add(NewHeader(h));
        }
        foreach (var c in clientIds)
        {
            seed.TucClients.Add(NewClient(c));
        }
        await seed.SaveChangesAsync();
    }

    private static ScheduleScopeOverrideDto ScheduleScope(
        int? cutoffHours = null,
        string weekDays = null,
        bool? isActive = null,
        string displayName = null,
        string displayDescription = null)
        => new(cutoffHours, null, null, weekDays, isActive, displayName, displayDescription);

    private static LegScopeOverrideDto LegScope(
        int? speedId = null,
        int? zoneGroupId = null,
        string pickupTimeMode = null,
        string windowStart = null,
        string windowEnd = null)
        => new(speedId, zoneGroupId, pickupTimeMode, windowStart, windowEnd, null);

    // ─── PutAsync ───────────────────────────────────────────────────────────

    [Fact]
    public async Task PutAsync_creates_schedule_scope_row_only_when_schedule_fields_set()
    {
        var svc = NewSvc(out var seed, out var opts);
        await SeedAsync(seed, new[] { HeaderA }, new[] { ClientA });

        var req = new ScheduleOverridePutRequest(
            Schedule: ScheduleScope(cutoffHours: 3),
            Collection: null,
            Delivery: null);
        await svc.PutAsync(HeaderA, ClientA, req, Actor);

        using var read = CockpitTestHarness.Context(opts);
        var rows = await read.BulkRunScheduleOverrides
            .Where(o => o.ScheduleId == HeaderA)
            .ToListAsync();
        var single = Assert.Single(rows);
        Assert.Equal(BulkRunScheduleOverride.ScopeSchedule, single.Scope);
        Assert.Equal(3, single.CutoffHours);
        Assert.Equal(ClientA, single.ClientId);
        Assert.Equal(Actor, single.CreatedBy);

        var header = await read.BulkRunScheduleHeaders.SingleAsync(h => h.ScheduleId == HeaderA);
        Assert.Equal(1, header.OverrideCount);
    }

    [Fact]
    public async Task PutAsync_creates_collection_and_delivery_rows_for_leg_scopes()
    {
        var svc = NewSvc(out var seed, out var opts);
        await SeedAsync(seed, new[] { HeaderA }, new[] { ClientA });

        var req = new ScheduleOverridePutRequest(
            Schedule: null,
            Collection: LegScope(speedId: 164),
            Delivery: LegScope(speedId: 200));
        await svc.PutAsync(HeaderA, ClientA, req, Actor);

        using var read = CockpitTestHarness.Context(opts);
        var rows = await read.BulkRunScheduleOverrides
            .Where(o => o.ScheduleId == HeaderA && o.ClientId == ClientA)
            .OrderBy(o => o.Scope)
            .ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal(BulkRunScheduleOverride.ScopeCollection, rows[0].Scope);
        Assert.Equal(164, rows[0].SpeedId);
        Assert.Equal(BulkRunScheduleOverride.ScopeDelivery, rows[1].Scope);
        Assert.Equal(200, rows[1].SpeedId);

        var header = await read.BulkRunScheduleHeaders.SingleAsync(h => h.ScheduleId == HeaderA);
        Assert.Equal(1, header.OverrideCount);
    }

    [Fact]
    public async Task PutAsync_replaces_existing_rows_for_same_client()
    {
        var svc = NewSvc(out var seed, out var opts);
        await SeedAsync(seed, new[] { HeaderA }, new[] { ClientA });

        // First put: schedule-scope only.
        await svc.PutAsync(HeaderA, ClientA, new ScheduleOverridePutRequest(
            Schedule: ScheduleScope(cutoffHours: 3, displayName: "Client A view"),
            Collection: null,
            Delivery: null), Actor);

        // Second put: collection-scope only. Schedule row must be gone.
        await svc.PutAsync(HeaderA, ClientA, new ScheduleOverridePutRequest(
            Schedule: null,
            Collection: LegScope(speedId: 999),
            Delivery: null), Actor);

        using var read = CockpitTestHarness.Context(opts);
        var rows = await read.BulkRunScheduleOverrides
            .Where(o => o.ScheduleId == HeaderA && o.ClientId == ClientA)
            .ToListAsync();
        var single = Assert.Single(rows);
        Assert.Equal(BulkRunScheduleOverride.ScopeCollection, single.Scope);
        Assert.Equal(999, single.SpeedId);
        Assert.Null(single.CutoffHours);
        Assert.Null(single.DisplayName);

        var header = await read.BulkRunScheduleHeaders.SingleAsync(h => h.ScheduleId == HeaderA);
        Assert.Equal(1, header.OverrideCount);
    }

    [Fact]
    public async Task PutAsync_deletes_rows_when_scope_wholly_null()
    {
        var svc = NewSvc(out var seed, out var opts);
        await SeedAsync(seed, new[] { HeaderA }, new[] { ClientA });

        await svc.PutAsync(HeaderA, ClientA, new ScheduleOverridePutRequest(
            Schedule: ScheduleScope(cutoffHours: 3),
            Collection: LegScope(speedId: 5),
            Delivery: null), Actor);

        // Wholly-null put deletes every row for this client.
        await svc.PutAsync(HeaderA, ClientA, new ScheduleOverridePutRequest(
            Schedule: null,
            Collection: null,
            Delivery: null), Actor);

        using var read = CockpitTestHarness.Context(opts);
        var rows = await read.BulkRunScheduleOverrides
            .Where(o => o.ScheduleId == HeaderA && o.ClientId == ClientA)
            .ToListAsync();
        Assert.Empty(rows);

        var header = await read.BulkRunScheduleHeaders.SingleAsync(h => h.ScheduleId == HeaderA);
        Assert.Equal(0, header.OverrideCount);
    }

    [Fact]
    public async Task PutAsync_throws_when_schedule_not_found()
    {
        var svc = NewSvc(out var seed, out _);
        await SeedAsync(seed, headerIds: Array.Empty<int>(), clientIds: new[] { ClientA });

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.PutAsync(9999, ClientA, new ScheduleOverridePutRequest(
                Schedule: ScheduleScope(cutoffHours: 3),
                Collection: null,
                Delivery: null), Actor));
        Assert.Contains("Schedule 9999", ex.Message);
    }

    [Fact]
    public async Task PutAsync_throws_when_schedule_is_retired()
    {
        var svc = NewSvc(out var seed, out _);
        var retired = NewHeader(HeaderA);
        retired.RetiredUtc = DateTime.UtcNow;
        seed.BulkRunScheduleHeaders.Add(retired);
        seed.TucClients.Add(NewClient(ClientA));
        await seed.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.PutAsync(HeaderA, ClientA, new ScheduleOverridePutRequest(
                Schedule: ScheduleScope(cutoffHours: 3),
                Collection: null,
                Delivery: null), Actor));
        Assert.Contains("not found or retired", ex.Message);
    }

    [Fact]
    public async Task PutAsync_throws_when_client_not_found()
    {
        var svc = NewSvc(out var seed, out _);
        await SeedAsync(seed, new[] { HeaderA }, clientIds: Array.Empty<int>());

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.PutAsync(HeaderA, 4242, new ScheduleOverridePutRequest(
                Schedule: ScheduleScope(cutoffHours: 3),
                Collection: null,
                Delivery: null), Actor));
        Assert.Contains("Client 4242", ex.Message);
    }

    // ─── DeleteAsync ────────────────────────────────────────────────────────

    [Fact]
    public async Task DeleteAsync_removes_all_rows_for_client_on_schedule()
    {
        var svc = NewSvc(out var seed, out var opts);
        await SeedAsync(seed, new[] { HeaderA }, new[] { ClientA, ClientB });

        // Two clients with deltas on the same header.
        await svc.PutAsync(HeaderA, ClientA, new ScheduleOverridePutRequest(
            Schedule: ScheduleScope(cutoffHours: 3),
            Collection: LegScope(speedId: 5),
            Delivery: null), Actor);
        await svc.PutAsync(HeaderA, ClientB, new ScheduleOverridePutRequest(
            Schedule: ScheduleScope(cutoffHours: 4),
            Collection: null,
            Delivery: null), Actor);

        using (var midread = CockpitTestHarness.Context(opts))
        {
            var midHeader = await midread.BulkRunScheduleHeaders.SingleAsync(h => h.ScheduleId == HeaderA);
            Assert.Equal(2, midHeader.OverrideCount);
        }

        await svc.DeleteAsync(HeaderA, ClientA);

        using var read = CockpitTestHarness.Context(opts);
        var remaining = await read.BulkRunScheduleOverrides
            .Where(o => o.ScheduleId == HeaderA)
            .ToListAsync();
        Assert.Single(remaining);
        Assert.Equal(ClientB, remaining[0].ClientId);

        var header = await read.BulkRunScheduleHeaders.SingleAsync(h => h.ScheduleId == HeaderA);
        Assert.Equal(1, header.OverrideCount);
    }

    // ─── ListForScheduleAsync ───────────────────────────────────────────────

    [Fact]
    public async Task ListForScheduleAsync_returns_one_entry_per_client_with_scopes_populated()
    {
        var svc = NewSvc(out var seed, out _);
        await SeedAsync(seed, new[] { HeaderA }, new[] { ClientA, ClientB });

        // Client A: schedule + collection rows. Client B: delivery row only.
        await svc.PutAsync(HeaderA, ClientA, new ScheduleOverridePutRequest(
            Schedule: ScheduleScope(cutoffHours: 3, displayName: "A view"),
            Collection: LegScope(speedId: 5),
            Delivery: null), Actor);
        await svc.PutAsync(HeaderA, ClientB, new ScheduleOverridePutRequest(
            Schedule: null,
            Collection: null,
            Delivery: LegScope(zoneGroupId: 77)), Actor);

        var dtos = await svc.ListForScheduleAsync(HeaderA);
        Assert.Equal(2, dtos.Count);

        var a = dtos.Single(d => d.ClientId == ClientA);
        Assert.NotNull(a.Schedule);
        Assert.Equal(3, a.Schedule.CutoffHours);
        Assert.Equal("A view", a.Schedule.DisplayName);
        Assert.NotNull(a.Collection);
        Assert.Equal(5, a.Collection.SpeedId);
        Assert.Null(a.Delivery);

        var b = dtos.Single(d => d.ClientId == ClientB);
        Assert.Null(b.Schedule);
        Assert.Null(b.Collection);
        Assert.NotNull(b.Delivery);
        Assert.Equal(77, b.Delivery.ZoneGroupId);
    }

    [Fact]
    public async Task ListForScheduleAsync_returns_empty_when_header_missing_or_retired()
    {
        var svc = NewSvc(out var seed, out _);
        var retired = NewHeader(HeaderA);
        retired.RetiredUtc = DateTime.UtcNow;
        seed.BulkRunScheduleHeaders.Add(retired);
        await seed.SaveChangesAsync();

        Assert.Empty(await svc.ListForScheduleAsync(HeaderA));
        Assert.Empty(await svc.ListForScheduleAsync(9999));
    }

    // ─── ListForClientAsync ─────────────────────────────────────────────────

    [Fact]
    public async Task ListForClientAsync_returns_every_schedule_client_differs_on()
    {
        var svc = NewSvc(out var seed, out _);
        await SeedAsync(seed, new[] { HeaderA, HeaderB }, new[] { ClientA });

        await svc.PutAsync(HeaderA, ClientA, new ScheduleOverridePutRequest(
            Schedule: ScheduleScope(cutoffHours: 3),
            Collection: null,
            Delivery: null), Actor);
        await svc.PutAsync(HeaderB, ClientA, new ScheduleOverridePutRequest(
            Schedule: null,
            Collection: LegScope(speedId: 5),
            Delivery: LegScope(zoneGroupId: 12)), Actor);

        var refs = await svc.ListForClientAsync(ClientA);
        Assert.Equal(2, refs.Count);
        Assert.Contains(refs, r => r.ScheduleId == HeaderA
            && r.Scopes.SequenceEqual(new[] { BulkRunScheduleOverride.ScopeSchedule }));
        Assert.Contains(refs, r => r.ScheduleId == HeaderB
            && r.Scopes.SequenceEqual(new[]
            {
                BulkRunScheduleOverride.ScopeCollection,
                BulkRunScheduleOverride.ScopeDelivery,
            }));
    }

    // ─── GetOverrideCountsAsync ─────────────────────────────────────────────

    [Fact]
    public async Task GetOverrideCountsAsync_returns_map_of_scheduleId_to_count()
    {
        var svc = NewSvc(out var seed, out _);
        await SeedAsync(seed,
            headerIds: new[] { HeaderA, HeaderB, HeaderC },
            clientIds: new[] { ClientA, ClientB, ClientC });

        // HeaderA: two distinct clients.
        await svc.PutAsync(HeaderA, ClientA, new ScheduleOverridePutRequest(
            Schedule: ScheduleScope(cutoffHours: 3),
            Collection: null,
            Delivery: null), Actor);
        await svc.PutAsync(HeaderA, ClientB, new ScheduleOverridePutRequest(
            Schedule: ScheduleScope(cutoffHours: 4),
            Collection: null,
            Delivery: null), Actor);
        // HeaderB: one client.
        await svc.PutAsync(HeaderB, ClientC, new ScheduleOverridePutRequest(
            Schedule: null,
            Collection: LegScope(speedId: 12),
            Delivery: null), Actor);
        // HeaderC: none.

        var counts = await svc.GetOverrideCountsAsync(new[] { HeaderA, HeaderB, HeaderC });
        Assert.Equal(2, counts[HeaderA]);
        Assert.Equal(1, counts[HeaderB]);
        Assert.Equal(0, counts[HeaderC]);
    }
}
