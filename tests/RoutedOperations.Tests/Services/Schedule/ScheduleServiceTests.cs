using System.Data.Common;
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
public class ScheduleServiceTests : IDisposable
{
    // Sqlite, not InMemory, since 2026-10-09. The write path targets
    // tblBulkRunScheduleDay and every read comes back through the
    // tblBulkRunSchedule VIEW over it, so the two have to be the same store
    // or a save is invisible to the read that verifies it. InMemory keeps one
    // dictionary per entity type and has no notion of a view, so these tests
    // would pass or fail for reasons unrelated to the product.
    private readonly List<DbConnection> _connections = new();

    public void Dispose()
    {
        foreach (var c in _connections) c.Dispose();
    }

    /// <summary>
    /// A converter that reports "not attempted", which is what the real one
    /// does on a provider with no stored procedures. The in-memory store
    /// these tests run on is exactly that, so no test here can observe a
    /// conversion; the tests that care about convert-on-save assert that it
    /// was CALLED, and the derivation itself is verified against a real
    /// database, not here.
    /// </summary>
    private static IScheduleConverter NewConverter() =>
        Substitute.For<IScheduleConverter>();

    private ScheduleService NewSvc() => NewSvc(out _);

    private ScheduleService NewSvc(out IScheduleConverter converter)
    {
        var (opts, connection) = CockpitTestHarness.NewSqliteOptions();
        _connections.Add(connection);
        var accessor = new HttpContextAccessor();
        var cache = new TenantScopedCache(
            new MemoryCache(new MemoryCacheOptions()),
            accessor);
        converter = NewConverter();
        return new ScheduleService(
            CockpitTestHarness.Factory(opts),
            NullLogger<ScheduleService>.Instance,
            cache,
            converter,
            accessor);
    }

    /// <summary>Constructs the service AND hands back the shared
    /// DbContextOptions + a seed context so tests that need to plant
    /// header + client + day-row + override rows before calling the
    /// service can do so directly (mirrors ScheduleOverrideServiceTests'
    /// NewSvc(out ..., out ...) pattern).</summary>
    /// <summary>
    /// InMemory variant, for a test that cannot use the Sqlite harness.
    ///
    /// ListSummaryAsync fans its queries out across ~11 contexts in parallel
    /// waves on purpose (the 2026-09-17 perf pass). A Sqlite :memory:
    /// database lives on ONE connection, and EF registers custom SQL
    /// functions when a context first touches it, so the second context in a
    /// wave fails with "database is locked". That is a property of the test
    /// harness, not of the code under test.
    ///
    /// The cost of staying on InMemory: it has no notion of a view, so a seed
    /// may write TblBulkRunSchedule, which a relational provider refuses.
    /// Acceptable for a test about how the summary labels client overrides.
    /// The view-versus-table split is covered by ScheduleModelShapeTests and
    /// by verification against a real database.
    /// </summary>
    private static ScheduleService NewSvcWithSeedInMemory(
        out DynamicDespatchDbContext seed,
        out DbContextOptions<DespatchContext> opts)
    {
        opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var accessor = new HttpContextAccessor();
        var cache = new TenantScopedCache(
            new MemoryCache(new MemoryCacheOptions()),
            accessor);
        return new ScheduleService(
            CockpitTestHarness.Factory(opts),
            NullLogger<ScheduleService>.Instance,
            cache,
            NewConverter(),
            accessor);
    }

    private ScheduleService NewSvcWithSeed(
        out DynamicDespatchDbContext seed,
        out DbContextOptions<DespatchContext> opts) =>
        NewSvcWithSeed(out seed, out opts, out _);

    private ScheduleService NewSvcWithSeed(
        out DynamicDespatchDbContext seed,
        out DbContextOptions<DespatchContext> opts,
        out IScheduleConverter converter)
    {
        var (sqliteOpts, connection) = CockpitTestHarness.NewSqliteOptions();
        _connections.Add(connection);
        opts = sqliteOpts;
        seed = CockpitTestHarness.Context(opts);
        converter = NewConverter();
        var accessor = new HttpContextAccessor();
        var cache = new TenantScopedCache(
            new MemoryCache(new MemoryCacheOptions()),
            accessor);
        return new ScheduleService(
            CockpitTestHarness.Factory(opts),
            NullLogger<ScheduleService>.Instance,
            cache,
            converter,
            accessor);
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

    // ─── F23: the preview closes a run at the same moment the booking page does ───

    [Theory]
    // Absolute pair, same day: Monday run, cutoff Monday 15:00.
    [InlineData("2026-10-19", 1, "08:00", 2, (byte)1, "15:00", "2026-10-19 15:00")]
    // Absolute pair, the day before: #713 KSFRS, cutoff 17:00 the day before a
    // Friday run. This is the case Anisah caught: tested Thursday 18:15, the
    // preview offered Friday and the booking page did not.
    [InlineData("2026-10-23", 5, "08:00", 2, (byte)4, "17:00", "2026-10-22 17:00")]
    // Absolute pair reaching back across the weekend: a Monday run whose
    // cutoff is the previous Friday. The offset has to be -3, not +4.
    [InlineData("2026-10-19", 1, "08:00", 2, (byte)5, "16:00", "2026-10-16 16:00")]
    // No pair, so the relative form, unchanged: start minus CutoffHours.
    [InlineData("2026-10-19", 1, "08:00", 2, null, null, "2026-10-19 06:00")]
    // A pair is only honoured when BOTH halves are present; a lone day falls
    // back rather than inventing midnight.
    [InlineData("2026-10-19", 1, "08:00", 3, (byte)1, null, "2026-10-19 05:00")]
    public void CutoffFor_matches_the_availability_function(
        string runDate, int isoDay, string startTime, int cutoffHours,
        byte? cutoffDay, string? cutoffTime, string expected)
    {
        // F23. The preview and the booking page disagreed because the preview
        // only ever computed "start minus CutoffHours" while the availability
        // function uses the absolute CutoffDay / CutoffTime pair when the
        // schedule has one. Six schedules showed it, including a run the
        // preview offered after its cutoff had passed.
        //
        // These cases encode the rule rather than the arithmetic: the day
        // offset must land on the most recent occurrence of the cutoff weekday
        // at or BEFORE the run day. If someone writes the obvious
        // (cutoffDay - isoDay) and loses the modulo, the Friday-before-Monday
        // case goes four days forward instead of three days back, which would
        // close ordering after the run had already started.
        var actual = ScheduleService.CutoffFor(
            DateTime.Parse(runDate),
            isoDay,
            TimeSpan.Parse(startTime),
            cutoffHours,
            cutoffDay,
            cutoffTime is null ? null : TimeSpan.Parse(cutoffTime));

        Assert.Equal(DateTime.Parse(expected), actual);
    }

    // ─── F24: a depot-origin schedule keeps its depot ───────────────────

    [Fact]
    public async Task UpsertAsync_keeps_PickupDepotId_when_a_depot_origin_save_omits_it()
    {
        // F24, the blocker from Anisah's 14 to 16 Oct smoke test. Both modals
        // derived PickupDepotId only when the chain had a Collection leg, so a
        // rename-and-save on a cross-depot schedule with BookPickup = 0 sent
        // null and nulled the column on every day row. Client Manager then
        // read it as "Client Address" and the schedule left the booking page.
        //
        // The derivation is fixed in the modals, but this asserts the SERVER
        // half, because that is the only place the column is written and a
        // stale bundle or a direct API call would otherwise do the same thing
        // just as quietly. On Urgent production 5,211 day rows across 1,531
        // schedules were one save away from it.
        //
        // The test sends a second save with no depot and BookPickup false,
        // which is exactly the payload the broken frontend produced.
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            var create = ValidRequest();
            create.OriginType = "depot";
            create.PickupDepotId = 7;
            create.BookPickup = false;
            var created = await svc.UpsertAsync(create);

            var resave = ValidRequest();
            resave.ScheduleId = created.ScheduleId;
            resave.Name = "Test Group renamed";
            resave.OriginType = "depot";
            resave.PickupDepotId = null;
            resave.BookPickup = false;
            await svc.UpsertAsync(resave);

            using var read = CockpitTestHarness.Context(opts);
            var rows = read.TblBulkRunScheduleDays
                .Where(r => r.ScheduleId == created.ScheduleId)
                .ToList();
            Assert.NotEmpty(rows);
            Assert.All(rows, r => Assert.Equal(7, r.PickupDepotId));
        }
    }

    [Fact]
    public async Task UpsertAsync_still_clears_PickupDepotId_for_a_non_depot_origin()
    {
        // The other half of the same rule, and the reason the guard is scoped
        // to a depot origin rather than refusing every null. A Direct origin
        // takes its pickup address from the booking and stores no depot, so
        // switching a schedule to it MUST clear the column. A guard that
        // blocked this would quietly pin the old depot on a schedule that no
        // longer starts at one: the same class of silent wrong data as F24,
        // in the other direction.
        //
        // Direct rather than Client deliberately. A client origin is rejected
        // on a default schedule, and nothing in Routed Operations ever sets
        // IsDefault to 0, so that path is unreachable through this service
        // today. Direct is explicitly exempt from that rule and is reachable,
        // so it is the honest way to test the property.
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            var create = ValidRequest();
            create.OriginType = "depot";
            create.PickupDepotId = 7;
            create.BookPickup = false;
            var created = await svc.UpsertAsync(create);

            var switchToDirect = ValidRequest();
            switchToDirect.ScheduleId = created.ScheduleId;
            switchToDirect.OriginType = "direct";
            switchToDirect.OriginRegionId = null;
            switchToDirect.PickupDepotId = null;
            switchToDirect.BookPickup = false;
            await svc.UpsertAsync(switchToDirect);

            using var read = CockpitTestHarness.Context(opts);
            var rows = read.TblBulkRunScheduleDays
                .Where(r => r.ScheduleId == created.ScheduleId)
                .ToList();
            Assert.NotEmpty(rows);
            Assert.All(rows, r => Assert.Null(r.PickupDepotId));
        }
    }

    // ─── convert-on-save ────────────────────────────────────────────────

    [Fact]
    public async Task UpsertAsync_asks_the_database_to_collapse_the_schedule()
    {
        // Convert-on-save is the entire migration of existing data in the
        // collapse plan: schedules collapse when someone touches them, and
        // there is no campaign to catch the ones nobody touches. If this
        // call stops happening, nothing fails and nothing converts, which is
        // the kind of regression that is invisible for months.
        //
        // Asserted at the seam rather than on its effect, because the
        // derivation lives in dbo.uspScheduleConvert and the in-memory
        // provider has no stored procedures. The effect is verified against
        // a real database.
        var svc = NewSvc(out var converter);
        var dto = await svc.UpsertAsync(ValidRequest());

        await converter.Received(1).ConvertAsync(
            Arg.Any<DbContext>(), dto.ScheduleId, true, Arg.Any<string>());
    }

    [Fact]
    public async Task UpsertAsync_surfaces_the_reason_a_schedule_did_not_collapse()
    {
        // A refusal is a normal answer, not a failure: the schedule saves,
        // stays on one row per day, and is still bookable. What must not
        // happen is the operator seeing a clean save with no hint that two
        // of their days disagree, so the reason rides back on the DTO.
        var svc = NewSvc(out var converter);
        converter.ConvertAsync(Arg.Any<DbContext>(), Arg.Any<int>(), Arg.Any<bool>(), Arg.Any<string>())
            .Returns(new ScheduleConvertResult
            {
                CanConvert = false,
                Reasons = "WindowVariesByDay;",
            });

        var dto = await svc.UpsertAsync(ValidRequest());

        Assert.False(dto.IsCollapsed);
        Assert.Null(dto.OccurrencesAhead);
        Assert.Equal("WindowVariesByDay;", dto.ConvertRefusalReasons);
    }

    [Fact]
    public async Task UpsertAsync_reports_no_refusal_when_the_schedule_collapsed()
    {
        var svc = NewSvc(out var converter);
        converter.ConvertAsync(Arg.Any<DbContext>(), Arg.Any<int>(), Arg.Any<bool>(), Arg.Any<string>())
            .Returns(new ScheduleConvertResult { CanConvert = true, Committed = true });

        var dto = await svc.UpsertAsync(ValidRequest());

        Assert.Null(dto.ConvertRefusalReasons);
    }

    // ─── ScheduleConvertGuard on the save paths (Steve, 5 Nov 2026) ─────

    private static ScheduleGroupUpsertRequest DifferingCutoffsRequest()
    {
        var req = ValidRequest();
        req.DayWindows[1].CutoffTime = "17:00";
        return req;
    }

    private static Task SetStoredCutoffToHoursOnlyAsync(DbContext db, int scheduleId, int hours) =>
        db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE tblBulkRunScheduleDay
               SET CutoffHours = {hours}, CutoffDay = NULL, CutoffTime = NULL
             WHERE ScheduleId = {scheduleId}
            """);

    private static ScheduleGroupUpsertRequest NoCutoffResave(int scheduleId)
    {
        var req = ValidRequest();
        req.ScheduleId = scheduleId;
        req.DayWindows = new List<DayWindowUpsertRequest>
        {
            new() { DayOfWeek = 1, StartTime = "08:00", EndTime = "17:00" },
            new() { DayOfWeek = 2, StartTime = "08:00", EndTime = "17:00" },
        };
        return req;
    }

    private static Task DidNotConvert(IScheduleConverter converter) =>
        converter.DidNotReceive().ConvertAsync(
            Arg.Any<DbContext>(), Arg.Any<int>(), Arg.Any<bool>(), Arg.Any<string>());

    [Fact]
    public async Task UpsertAsync_does_not_convert_when_cutoffs_differ_and_still_saves()
    {
        // Converting would move the minority day onto the majority cutoff for
        // every booking, because the view never reads the exception rows.
        var svc = NewSvcWithSeed(out var seed, out var opts, out var converter);
        using (seed)
        {
            var dto = await svc.UpsertAsync(DifferingCutoffsRequest());

            await DidNotConvert(converter);
            Assert.Equal(ScheduleConvertGuard.CutoffsDifferReason, dto.ConvertRefusalReasons);
            Assert.False(dto.IsCollapsed);
            Assert.Null(dto.OccurrencesAhead);

            using var read = CockpitTestHarness.Context(opts);
            var times = read.TblBulkRunScheduleDays
                .Where(r => r.ScheduleId == dto.ScheduleId)
                .OrderBy(r => r.DayOfWeek)
                .Select(r => r.CutoffTime)
                .ToList();
            Assert.Equal(new TimeSpan?[] { new(15, 0, 0), new(17, 0, 0) }, times);
        }
    }

    [Fact]
    public async Task UpsertAsync_on_a_collapsed_schedule_given_differing_cutoffs_ends_unconverted()
    {
        // The case in Steve's ruling: "only safe until someone edits one". The
        // save unconverts first, and the guard then stops it collapsing again.
        var svc = NewSvcWithSeed(out var seed, out var opts, out var converter);
        using (seed)
        {
            var created = await svc.UpsertAsync(ValidRequest());
            await CollapseAsync(seed, created.ScheduleId);
            converter.UnconvertAsync(Arg.Any<DbContext>(), created.ScheduleId)
                .Returns(ci => RestoreLikeUnconvertAsync(ci.Arg<DbContext>(), created.ScheduleId));
            converter.ClearReceivedCalls();

            var edit = DifferingCutoffsRequest();
            edit.ScheduleId = created.ScheduleId;
            var dto = await svc.UpsertAsync(edit);

            await converter.Received(1).UnconvertAsync(Arg.Any<DbContext>(), created.ScheduleId);
            await DidNotConvert(converter);
            Assert.False(dto.IsCollapsed);
            Assert.Equal(ScheduleConvertGuard.CutoffsDifferReason, dto.ConvertRefusalReasons);

            using var read = CockpitTestHarness.Context(opts);
            Assert.False(read.BulkRunScheduleDetails.Any(d => d.ScheduleId == created.ScheduleId));
        }
    }

    [Fact]
    public async Task UpsertAsync_does_not_convert_an_hours_only_schedule()
    {
        var svc = NewSvcWithSeed(out var seed, out var opts, out var converter);
        using (seed)
        {
            var created = await svc.UpsertAsync(ValidRequest());
            await SetStoredCutoffToHoursOnlyAsync(seed, created.ScheduleId, 999);
            converter.ClearReceivedCalls();

            var dto = await svc.UpsertAsync(NoCutoffResave(created.ScheduleId));

            await DidNotConvert(converter);
            Assert.Equal(ScheduleConvertGuard.HoursOnlyReason, dto.ConvertRefusalReasons);

            // The save keeps the stored hours, so the booking cutoff does not
            // move and the next save is held on the same rule.
            using (var read = CockpitTestHarness.Context(opts))
                Assert.All(
                    read.TblBulkRunScheduleDays.Where(r => r.ScheduleId == created.ScheduleId).ToList(),
                    r => Assert.Equal(999, r.CutoffHours));

            converter.ClearReceivedCalls();
            var again = await svc.UpsertAsync(NoCutoffResave(created.ScheduleId));
            await DidNotConvert(converter);
            Assert.Equal(ScheduleConvertGuard.HoursOnlyReason, again.ConvertRefusalReasons);
        }
    }

    [Fact]
    public async Task UpsertAsync_converts_once_an_hours_only_schedule_is_given_a_real_cutoff()
    {
        var svc = NewSvcWithSeed(out var seed, out _, out var converter);
        using (seed)
        {
            var created = await svc.UpsertAsync(ValidRequest());
            await SetStoredCutoffToHoursOnlyAsync(seed, created.ScheduleId, 999);
            converter.ClearReceivedCalls();

            var edit = ValidRequest();
            edit.ScheduleId = created.ScheduleId;
            await svc.UpsertAsync(edit);

            await converter.Received(1).ConvertAsync(
                Arg.Any<DbContext>(), created.ScheduleId, true, Arg.Any<string>());
        }
    }

    [Fact]
    public async Task UpsertAsync_clearing_a_cutoff_pair_is_not_mistaken_for_hours_only()
    {
        // The stored row has a pair and a derived offset. The operator removed
        // the cutoff, which is a no-cutoff schedule, and that converts.
        var svc = NewSvcWithSeed(out var seed, out _, out var converter);
        using (seed)
        {
            var created = await svc.UpsertAsync(ValidRequest());
            converter.ClearReceivedCalls();

            var dto = await svc.UpsertAsync(NoCutoffResave(created.ScheduleId));

            await converter.Received(1).ConvertAsync(
                Arg.Any<DbContext>(), created.ScheduleId, true, Arg.Any<string>());
            Assert.Null(dto.ConvertRefusalReasons);
        }
    }

    [Fact]
    public async Task UpsertAsync_ignores_a_dropped_day_when_comparing_cutoffs()
    {
        // Unticking the odd day out leaves days that agree. The blanked row is
        // the procedure's to judge, and it must not produce a false "cutoffs
        // differ" here.
        var svc = NewSvcWithSeed(out var seed, out _, out var converter);
        using (seed)
        {
            var create = ValidRequest();
            create.DayWindows.Add(new DayWindowUpsertRequest
            {
                DayOfWeek = 3, StartTime = "08:00", EndTime = "17:00", CutoffDay = 3, CutoffTime = "11:00",
            });
            var created = await svc.UpsertAsync(create);
            await DidNotConvert(converter);
            converter.ClearReceivedCalls();

            var edit = ValidRequest();
            edit.ScheduleId = created.ScheduleId;
            await svc.UpsertAsync(edit);

            await converter.Received(1).ConvertAsync(
                Arg.Any<DbContext>(), created.ScheduleId, true, Arg.Any<string>());
        }
    }

    [Fact]
    public async Task CopyAsync_does_not_convert_a_copy_of_a_schedule_whose_cutoffs_differ()
    {
        var svc = NewSvc(out var converter);
        var source = await svc.UpsertAsync(DifferingCutoffsRequest());

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceScheduleId = source.ScheduleId,
            NewName = "Held copy",
        });

        await DidNotConvert(converter);
        Assert.False(copy.IsCollapsed);
    }

    [Fact]
    public async Task CopyAsync_does_not_convert_a_copy_of_an_hours_only_schedule()
    {
        // Unlike a save, a copy carries the stored hours across.
        var svc = NewSvcWithSeed(out var seed, out var opts, out var converter);
        using (seed)
        {
            var source = await svc.UpsertAsync(ValidRequest());
            await SetStoredCutoffToHoursOnlyAsync(seed, source.ScheduleId, 999);
            converter.ClearReceivedCalls();

            var copy = await svc.CopyAsync(new ScheduleCopyRequest
            {
                SourceScheduleId = source.ScheduleId,
                NewName = "Hours copy",
            });

            await DidNotConvert(converter);
            using var read = CockpitTestHarness.Context(opts);
            Assert.All(
                read.TblBulkRunScheduleDays.Where(r => r.ScheduleId == copy.ScheduleId).ToList(),
                r => Assert.Equal(999, r.CutoffHours));
        }
    }

    [Fact]
    public async Task CopyAsync_still_converts_a_copy_whose_cutoffs_agree()
    {
        var svc = NewSvc(out var converter);
        var source = await svc.UpsertAsync(ValidRequest());
        converter.ClearReceivedCalls();

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceScheduleId = source.ScheduleId,
            NewName = "Plain copy",
        });

        await converter.Received(1).ConvertAsync(
            Arg.Any<DbContext>(), copy.ScheduleId, true, Arg.Any<string>());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(61)]
    public async Task UpsertAsync_rejects_occurrences_ahead_outside_one_to_sixty(byte n)
    {
        // The CHECK on the column says 1 to 60. Rejected here so the caller
        // is told which field is wrong instead of getting a constraint
        // violation from the database.
        var svc = NewSvc();
        var req = ValidRequest();
        req.OccurrencesAhead = n;
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(req));
        Assert.Contains("1 and 60", ex.Message);
    }

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
    public async Task Postcode_binding_is_written_with_BOTH_the_id_and_the_name()
    {
        // The re-key of tblSchedulePostcode onto ScheduleId is in its
        // transition: dbmigrationsv2 20261016165000 adds the id nullable, and
        // ScheduleName stays NOT NULL as half of the database primary key
        // until a later migration moves it. So a row has to carry both, and
        // the reason is not symmetry:
        //
        //   * drop the NAME and the real INSERT fails on a NOT NULL primary
        //     key column, on every tenant, while the round-trip tests above
        //     stay green because they read back through the same id.
        //   * drop the ID and the row becomes invisible to the bound-postcode
        //     half of availability spec 6.3, so the Coverage tab silently
        //     goes back to being a picture rather than a gate.
        //
        // This test exists to fail when either half is removed, which is
        // exactly what a round-trip assertion cannot see. Delete it only when
        // the step-3 migration has dropped ScheduleName on both tenants.
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            var req = ValidRequest();
            req.PostcodeIds = new List<int> { 1010 };
            var created = await svc.UpsertAsync(req);

            using var read = CockpitTestHarness.Context(opts);
            var row = Assert.Single(read.SchedulePostcodes.ToList());
            Assert.Equal(1010, row.PostCode);
            Assert.Equal(created.ScheduleId, row.ScheduleId);
            Assert.Equal(created.Name, row.ScheduleName);
        }
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

    // ─── M2 / B2 (2026-11-10): what a copy carries across ───
    //
    // #2910 "(copy)" on Urgent prod was created IsDefault = 1, so every
    // client in its region could book a half-edited copy until it was retired
    // 71 seconds later. The same path also dropped the display name, the
    // booking horizon, the AutoBook scan-ahead and recurring flags, and turned
    // a client-origin schedule into a depot one. Each test below was run
    // against the old CopyAsync first and failed there.

    [Fact]
    public async Task CopyAsync_is_not_a_default_unless_the_caller_asks_for_one()
    {
        var svc = NewSvc();
        var src = ValidRequest();
        src.Name = "Source";
        var source = await svc.UpsertAsync(src);
        Assert.True(source.IsDefault);

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceScheduleId = source.ScheduleId,
            NewName = "Source (copy)",
        });
        // Bookable by nobody until someone links a client or makes it a
        // default on purpose, which is the safe state for a fresh copy.
        Assert.False(copy.IsDefault);

        var asked = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceScheduleId = source.ScheduleId,
            NewName = "Source (copy 2)",
            IsDefault = true,
        });
        Assert.True(asked.IsDefault);
    }

    [Fact]
    public async Task CopyAsync_carries_display_name_and_description()
    {
        var svc = NewSvc();
        var src = ValidRequest();
        src.Name = "Source";
        src.DisplayName = "Shown to clients";
        src.DisplayDescription = "Book by 11am";
        var source = await svc.UpsertAsync(src);

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceScheduleId = source.ScheduleId,
            NewName = "Source (copy)",
        });

        Assert.Equal("Shown to clients", copy.DisplayName);
        Assert.Equal("Book by 11am", copy.DisplayDescription);
    }

    [Fact]
    public async Task CopyAsync_keeps_client_origin_unless_the_copy_is_made_a_default()
    {
        var svc = NewSvc();
        var src = ValidRequest();
        src.Name = "Source";
        src.IsDefault = false;
        src.ClientIds = new List<int> { 100 };
        src.OriginType = "client";
        src.OriginRegionId = 7;
        var source = await svc.UpsertAsync(src);
        Assert.Equal("client", source.OriginType);

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceScheduleId = source.ScheduleId,
            NewName = "Source (copy)",
        });
        Assert.Equal("client", copy.OriginType);
        Assert.Equal(7, copy.OriginRegionId);

        // Spec 2.1 still holds: a default cannot start at a client address,
        // so an explicit default copy falls back to depot, as before.
        var asDefault = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceScheduleId = source.ScheduleId,
            NewName = "Source (default copy)",
            IsDefault = true,
        });
        Assert.Equal("depot", asDefault.OriginType);
        Assert.Null(asDefault.OriginRegionId);
    }

    [Fact]
    public async Task CopyAsync_carries_scan_ahead_and_recurring_flags_from_the_day_rows()
    {
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            var source = await svc.UpsertAsync(ValidRequest());
            await seed.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE tblBulkRunScheduleDay
                   SET AutoBookScanAhead = 14, IsRecurringSchedule = 1
                 WHERE ScheduleId = {source.ScheduleId}
                """);

            var copy = await svc.CopyAsync(new ScheduleCopyRequest
            {
                SourceScheduleId = source.ScheduleId,
                NewName = "Scan copy",
            });

            using var read = CockpitTestHarness.Context(opts);
            var rows = read.TblBulkRunScheduleDays.Where(r => r.ScheduleId == copy.ScheduleId).ToList();
            Assert.Equal(2, rows.Count);
            Assert.All(rows, r =>
            {
                Assert.Equal(14, r.AutoBookScanAhead);
                Assert.True(r.IsRecurringSchedule);
            });
        }
    }

    [Fact]
    public async Task CopyAsync_of_a_collapsed_schedule_carries_its_detail_row_settings()
    {
        // On a collapsed source the scan-ahead, recurring flag and booking
        // horizon live on the detail row, not the day rows. The copy is
        // written in the old shape and then converted, and uspScheduleConvert
        // seeds OccurrencesAhead from the active-day count (one week's
        // worth), so without carrying it the copy offers a different number
        // of runs from its source.
        var svc = NewSvcWithSeed(out var seed, out var opts, out var converter);
        using (seed)
        {
            var source = await svc.UpsertAsync(ValidRequest());
            seed.BulkRunScheduleDetails.Add(new BulkRunScheduleDetail
            {
                ScheduleId = source.ScheduleId,
                WeekDays = "1100000",
                CutoffDayUnit = "W",
                OccurrencesAhead = 12,
                AutoBookScanAhead = 21,
                IsRecurringSchedule = true,
                CreatedUtc = DateTime.UtcNow,
                CreatedBy = "test",
            });
            await seed.SaveChangesAsync();

            // Stand-in for uspScheduleConvert: collapse the copy onto a detail
            // row seeded the way the procedure seeds it.
            converter.ConvertAsync(Arg.Any<DbContext>(), Arg.Any<int>(), Arg.Any<bool>(), Arg.Any<string>())
                .Returns(async ci =>
                {
                    var ctx = ci.Arg<DbContext>();
                    var id = ci.ArgAt<int>(1);
                    ctx.Set<BulkRunScheduleDetail>().Add(new BulkRunScheduleDetail
                    {
                        ScheduleId = id,
                        WeekDays = "1100000",
                        CutoffDayUnit = "W",
                        OccurrencesAhead = 2,
                        CreatedUtc = DateTime.UtcNow,
                        CreatedBy = "convert",
                    });
                    await ctx.SaveChangesAsync();
                    return new ScheduleConvertResult { ScheduleId = id, CanConvert = true };
                });

            var copy = await svc.CopyAsync(new ScheduleCopyRequest
            {
                SourceScheduleId = source.ScheduleId,
                NewName = "Collapsed copy",
            });

            Assert.Equal((byte)12, copy.OccurrencesAhead);
            using var read = CockpitTestHarness.Context(opts);
            var rows = read.TblBulkRunScheduleDays.Where(r => r.ScheduleId == copy.ScheduleId).ToList();
            Assert.All(rows, r =>
            {
                Assert.Equal(21, r.AutoBookScanAhead);
                Assert.True(r.IsRecurringSchedule);
            });
        }
    }

    [Fact]
    public async Task CopyAsync_leaves_IsActive_as_it_was_pending_D4()
    {
        // Pins CURRENT behaviour on purpose. D4 (should a copy start
        // inactive?) is not settled, and Q8 ties it to N6. When D4 is
        // decided this test is the one to change, deliberately.
        var svc = NewSvc();
        var src = ValidRequest();
        src.Name = "Source";
        src.IsActive = false;
        var source = await svc.UpsertAsync(src);
        Assert.False(source.IsActive);

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceScheduleId = source.ScheduleId,
            NewName = "Source (copy)",
        });

        Assert.True(copy.IsActive);
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
        var svc = NewSvcWithSeedInMemory(out var seed, out var opts);
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
        // Seeded through the view entity, which only works because this test
        // runs on InMemory; see NewSvcWithSeedInMemory for why it has to.
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
    public async Task UpsertAsync_resave_and_copy_preserve_ChargePerConsignment()
    {
        // Cartons-once is a pricing flag set per leg. The save path removes and
        // re-adds every leg, so a leg that does not carry it back switches the
        // rule off without anyone noticing.
        var svc = NewSvc();
        var req = ValidRequest();
        req.Linehauls.Add(Leg("Flagged leg", 1, 2));
        req.Linehauls.Add(Leg("Plain leg", 2, 3));
        req.Linehauls[0].ChargePerConsignment = true;
        var created = await svc.UpsertAsync(req);
        Assert.Equal(new[] { true, false }, created.Linehauls.Select(l => l.ChargePerConsignment).ToArray());

        var second = ValidRequest();
        foreach (var l in created.Linehauls)
        {
            var leg = Leg(l.Name, l.FromDepotId ?? 0, l.ToDepotId ?? 0, l.LegOrder);
            leg.ChargePerConsignment = l.ChargePerConsignment;
            second.Linehauls.Add(leg);
        }
        var resaved = await svc.UpsertAsync(second);
        Assert.Equal(new[] { true, false }, resaved.Linehauls.Select(l => l.ChargePerConsignment).ToArray());

        var copy = await svc.CopyAsync(new ScheduleCopyRequest
        {
            SourceScheduleId = resaved.ScheduleId,
            NewName = "Copied Flagged",
        });
        Assert.Equal(new[] { true, false }, copy.Linehauls.Select(l => l.ChargePerConsignment).ToArray());
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

    // ─── A cleared day row must stay readable through the compat view ───

    [Fact]
    public async Task UpsertAsync_clearing_a_day_row_leaves_the_view_mapped_columns_non_null()
    {
        // Dropping a weekday from a schedule blanks that day row rather than
        // deleting it, because other tables hold its id. The blanking is
        // correct; what was not, until 2026-10-20, is that it wrote NULL into
        // MaxJobs and CutoffHours. `dbo.tblBulkRunSchedule` is a compatibility
        // VIEW over this table and EF maps BOTH of those as non-nullable int,
        // so a NULL made every read of the schedule throw
        // SqlNullValueException out of the materialiser, and because the list
        // query reads the same view, one cleared row returned HTTP 500 for the
        // whole Schedules NEW list until it was repaired by hand.
        //
        // The detail row's weekday mask normally hides a cleared row, which is
        // why this hid for so long. But the convert refuses whenever the days
        // genuinely differ, the caller treats a refusal as a normal outcome,
        // and with no detail row the view emits every day row regardless.
        // The converter here reports "not attempted", which is that same
        // shape.
        //
        // 74 live schedules on Urgent production could not convert, so this
        // was reachable on all of them.
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            var create = ValidRequest();            // Monday and Tuesday
            var created = await svc.UpsertAsync(create);

            var drop = ValidRequest();              // Monday only
            drop.ScheduleId = created.ScheduleId;
            drop.DayWindows = new List<DayWindowUpsertRequest>
            {
                new() { DayOfWeek = 1, StartTime = "08:00", EndTime = "17:00", CutoffDay = 1, CutoffTime = "15:00" },
            };
            await svc.UpsertAsync(drop);

            using var read = CockpitTestHarness.Context(opts);
            var cleared = read.TblBulkRunScheduleDays
                .Single(r => r.ScheduleId == created.ScheduleId && r.DayOfWeek == 2);

            // Still cleared: the window is what makes it unbookable.
            Assert.Null(cleared.StartTime);
            Assert.Null(cleared.EndTime);
            Assert.Null(cleared.Region);

            // But readable. These two are the ones the view maps non-nullable.
            Assert.NotNull(cleared.MaxJobs);
            Assert.NotNull(cleared.CutoffHours);
        }
    }

    // ─── Saving a collapsed schedule: what EF compares against ───
    //
    // On a collapsed schedule the day rows hold NULL payload, and the save puts
    // the payload back with uspScheduleUnconvert before writing the operator's
    // values. That procedure writes behind EF's back. If the day rows were read
    // BEFORE it ran, EF still believes the columns are NULL, so setting one to
    // null is "no change" and is never sent; the restored old value then stays
    // on the day row and the convert copies it straight back onto the detail
    // row. The API returned 200 and the operator's clear silently did nothing
    // (schedule 60 on local NZ, 5 Nov 2026). Setting a NEW value always worked,
    // which is why this only ever showed up as "cannot clear a field".
    //
    // The stored procedures cannot run on Sqlite, so the converter seam stands
    // in with what the real unconvert does to the database: raw SQL on the
    // caller's own context and transaction, invisible to the change tracker.

    /// <summary>Puts a saved schedule in the collapsed shape: payload nulled
    /// off the day rows, one detail row present.</summary>
    private static async Task CollapseAsync(DynamicDespatchDbContext db, int scheduleId)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE tblBulkRunScheduleDay
               SET StartTime = NULL, EndTime = NULL, MaxJobs = NULL, Region = NULL,
                   SpeedId = NULL, CutoffHours = NULL, CutoffDay = NULL, CutoffTime = NULL,
                   Description = NULL, AutoBook = NULL, PostcodeGroupId = NULL,
                   BookPickup = NULL, PickupDepotId = NULL, StorageState = NULL,
                   DeliveryState = NULL, PickupRatingSpeed = NULL,
                   PickupPostcodeGroupId = NULL, ParentSpeedId = NULL,
                   PickupBoxDiscount = NULL, DropOffLocationID = NULL,
                   ApplyPickupCutoff = NULL, PickupCutoff = NULL,
                   AutoBookScanAhead = NULL, IsRecurringSchedule = NULL
             WHERE ScheduleId = {scheduleId}
            """);
        db.BulkRunScheduleDetails.Add(new BulkRunScheduleDetail
        {
            ScheduleId = scheduleId,
            WeekDays = "1100000",
            CutoffDayUnit = "W",
            OccurrencesAhead = 1,
            CreatedUtc = DateTime.UtcNow,
            CreatedBy = "test",
            PostcodeGroupId = 11,
        });
        await db.SaveChangesAsync();
    }

    /// <summary>What uspScheduleUnconvert does to the database: every payload
    /// column restored, detail row gone.</summary>
    private static async Task RestoreLikeUnconvertAsync(DbContext ctx, int scheduleId)
    {
        await ctx.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE tblBulkRunScheduleDay
               SET StartTime = '08:00:00', EndTime = '17:00:00', MaxJobs = 7, Region = 1,
                   SpeedId = 21, CutoffHours = 24, CutoffDay = 1, CutoffTime = '15:00:00',
                   Description = 'old description', AutoBook = 1, PostcodeGroupId = 11,
                   BookPickup = 1, PickupDepotId = 31, StorageState = 2,
                   DeliveryState = 3, PickupRatingSpeed = 41,
                   PickupPostcodeGroupId = 12, ParentSpeedId = 51,
                   PickupBoxDiscount = 5, DropOffLocationID = 61,
                   ApplyPickupCutoff = 1, PickupCutoff = 90,
                   AutoBookScanAhead = 3, IsRecurringSchedule = 1
             WHERE ScheduleId = {scheduleId}
            """);
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"DELETE FROM tblBulkRunScheduleDetail WHERE ScheduleId = {scheduleId}");
    }

    private async Task<(ScheduleService Svc, DbContextOptions<DespatchContext> Opts, int ScheduleId)>
        NewCollapsedScheduleAsync()
    {
        var svc = NewSvcWithSeed(out var seed, out var opts, out var converter);
        using (seed)
        {
            var created = await svc.UpsertAsync(ValidRequest());
            await CollapseAsync(seed, created.ScheduleId);
            converter.UnconvertAsync(Arg.Any<DbContext>(), created.ScheduleId)
                .Returns(ci => RestoreLikeUnconvertAsync(ci.Arg<DbContext>(), created.ScheduleId));
            return (svc, opts, created.ScheduleId);
        }
    }

    [Fact]
    public async Task UpsertAsync_on_a_collapsed_schedule_persists_every_cleared_field()
    {
        // Every field the request owns, cleared in one save. Direct origin
        // because that is the shape where clearing the depot is legitimate; the
        // depot-origin case is pinned separately below.
        var (svc, opts, scheduleId) = await NewCollapsedScheduleAsync();

        var clear = ValidRequest();
        clear.ScheduleId = scheduleId;
        clear.OriginType = "direct";
        clear.DayWindows = new List<DayWindowUpsertRequest>
        {
            new() { DayOfWeek = 1, StartTime = "08:00", EndTime = "17:00" },
            new() { DayOfWeek = 2, StartTime = "08:00", EndTime = "17:00" },
        };
        await svc.UpsertAsync(clear);

        using var read = CockpitTestHarness.Context(opts);
        var rows = read.TblBulkRunScheduleDays.Where(r => r.ScheduleId == scheduleId).ToList();
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r =>
        {
            Assert.Null(r.PostcodeGroupId);
            Assert.Null(r.PickupPostcodeGroupId);
            Assert.Null(r.SpeedId);
            Assert.Null(r.ParentSpeedId);
            Assert.Null(r.PickupDepotId);
            Assert.Null(r.StorageState);
            Assert.Null(r.DeliveryState);
            Assert.Null(r.PickupRatingSpeed);
            Assert.Null(r.PickupBoxDiscount);
            Assert.Null(r.DropOffLocationId);
            Assert.Null(r.AutoBook);
            Assert.Null(r.BookPickup);
            Assert.Null(r.ApplyPickupCutoff);
            Assert.Null(r.PickupCutoff);
            Assert.Null(r.Description);
            Assert.Null(r.CutoffDay);
            Assert.Null(r.CutoffTime);
            // Not a null, and hit by the same flaw from the other side: the
            // derived 0 was written, but only because the masked NULL differs
            // from it. Pinned so the pair and the offset stay in step.
            Assert.Equal(0, r.CutoffHours);
        });
    }

    [Fact]
    public async Task UpsertAsync_on_a_collapsed_schedule_keeps_values_the_request_does_not_own()
    {
        // MaxJobs (F8), AutoBookScanAhead and IsRecurringSchedule are not on the
        // request. Their only copy during the save is what the unconvert just
        // restored, so a fix that wrote stale in-memory NULLs over the restored
        // row would wipe them. This is why the rows are read after the unconvert
        // rather than having EF's original values patched up afterwards.
        var (svc, opts, scheduleId) = await NewCollapsedScheduleAsync();

        var save = ValidRequest();
        save.ScheduleId = scheduleId;
        await svc.UpsertAsync(save);

        using var read = CockpitTestHarness.Context(opts);
        Assert.All(read.TblBulkRunScheduleDays.Where(r => r.ScheduleId == scheduleId).ToList(), r =>
        {
            Assert.Equal(7, r.MaxJobs);
            Assert.Equal(3, r.AutoBookScanAhead);
            Assert.True(r.IsRecurringSchedule);
        });
    }

    [Fact]
    public async Task UpsertAsync_on_a_collapsed_schedule_still_refuses_to_clear_a_depot_origin_depot()
    {
        // F24. Now that a clear really takes effect, this guard is the only
        // thing between a depot-origin save with no depot and losing the depot.
        // It reads the row's current value, so it can only fire on a collapsed
        // schedule because the rows are read after the unconvert.
        var (svc, opts, scheduleId) = await NewCollapsedScheduleAsync();

        var save = ValidRequest();
        save.ScheduleId = scheduleId;
        save.OriginType = "depot";
        save.PickupDepotId = null;
        await svc.UpsertAsync(save);

        using var read = CockpitTestHarness.Context(opts);
        Assert.All(read.TblBulkRunScheduleDays.Where(r => r.ScheduleId == scheduleId).ToList(),
            r => Assert.Equal(31, r.PickupDepotId));
    }

    [Fact]
    public async Task UpsertAsync_on_a_collapsed_schedule_blanks_a_day_that_was_unticked()
    {
        // The same flaw, reached through ClearDayRowPayload rather than the
        // template: the dropped day kept its restored window, so the weekday the
        // operator removed stayed bookable.
        var (svc, opts, scheduleId) = await NewCollapsedScheduleAsync();

        var drop = ValidRequest();
        drop.ScheduleId = scheduleId;
        drop.DayWindows = new List<DayWindowUpsertRequest>
        {
            new() { DayOfWeek = 1, StartTime = "08:00", EndTime = "17:00", CutoffDay = 1, CutoffTime = "15:00" },
        };
        await svc.UpsertAsync(drop);

        using var read = CockpitTestHarness.Context(opts);
        var dropped = read.TblBulkRunScheduleDays.Single(r => r.ScheduleId == scheduleId && r.DayOfWeek == 2);
        Assert.Null(dropped.StartTime);
        Assert.Null(dropped.EndTime);
        Assert.Null(dropped.PostcodeGroupId);
    }

    // ─── N2: a header with two live day rows on one weekday ───
    //
    // Prod has 73 live headers shaped like this (VB1, 2026-11-06). The detail
    // modal keeps one row per weekday, so its save carries only one of the two
    // ids. SyncDayRowsAsync then treated the other row as a dropped day: it
    // blanked the row and deleted its zones and linehaul legs. The operator
    // never saw the second row and never asked for it to go.

    /// <summary>Creates a Mon + Tue schedule, then plants a second live Monday
    /// day row with its own zone row and linehaul leg, the way the duplicate
    /// rows exist on prod.</summary>
    private async Task<(ScheduleService Svc, DbContextOptions<DespatchContext> Opts,
            int ScheduleId, int FirstMondayId, int TuesdayId, int SecondMondayId)>
        NewScheduleWithDuplicateMondayAsync()
    {
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            var created = await svc.UpsertAsync(ValidRequest());
            var rows = seed.TblBulkRunScheduleDays.AsNoTracking()
                .Where(r => r.ScheduleId == created.ScheduleId).ToList();
            var monday = rows.Single(r => r.DayOfWeek == 1);
            var tuesday = rows.Single(r => r.DayOfWeek == 2);
            var second = new TblBulkRunScheduleDay
            {
                ScheduleId = created.ScheduleId,
                Name = monday.Name,
                DayOfWeek = 1,
                StartTime = new TimeSpan(18, 0, 0),
                EndTime = new TimeSpan(20, 0, 0),
                Region = monday.Region,
                MaxJobs = 0,
                CutoffHours = 0,
            };
            seed.TblBulkRunScheduleDays.Add(second);
            await seed.SaveChangesAsync();
            seed.BulkZoneSchedules.Add(new BulkZoneSchedule
            {
                ScheduleId = second.BulkRunScheduleId, Zone = 9, Active = true,
            });
            seed.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
            {
                BulkRunScheduleId = second.BulkRunScheduleId, Active = true, Name = "leg on second Monday",
            });
            await seed.SaveChangesAsync();
            return (svc, opts, created.ScheduleId, monday.BulkRunScheduleId,
                tuesday.BulkRunScheduleId, second.BulkRunScheduleId);
        }
    }

    [Fact]
    public async Task UpsertAsync_refuses_a_save_that_would_blank_a_duplicate_weekday_row()
    {
        var (svc, opts, scheduleId, firstMonday, tuesday, secondMonday) =
            await NewScheduleWithDuplicateMondayAsync();

        // Exactly what the modal sends: one window per weekday, each with the
        // id of the row it kept.
        var save = ValidRequest();
        save.ScheduleId = scheduleId;
        save.DayWindows = new List<DayWindowUpsertRequest>
        {
            new() { Id = firstMonday, DayOfWeek = 1, StartTime = "09:00", EndTime = "17:00", CutoffDay = 1, CutoffTime = "15:00" },
            new() { Id = tuesday, DayOfWeek = 2, StartTime = "09:00", EndTime = "17:00", CutoffDay = 2, CutoffTime = "15:00" },
        };

        // Before the guard this save returned normally and left the second
        // Monday blanked (StartTime/EndTime NULL) with its zone row and leg
        // deleted; that was pinned first and is what the guard now refuses.
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(save));
        Assert.Contains("more than one live day row for Monday", ex.Message);

        // Nothing changed: the second Monday keeps its window, zone and leg,
        // and the first Monday did not take the new 09:00 start either.
        using var read = CockpitTestHarness.Context(opts);
        var second = read.TblBulkRunScheduleDays.Single(r => r.BulkRunScheduleId == secondMonday);
        Assert.Equal(new TimeSpan(18, 0, 0), second.StartTime);
        Assert.Equal(new TimeSpan(20, 0, 0), second.EndTime);
        Assert.Single(read.BulkZoneSchedules.Where(z => z.ScheduleId == secondMonday).ToList());
        Assert.Single(read.TblBulkScheduleLinehauls.Where(l => l.BulkRunScheduleId == secondMonday).ToList());
        var first = read.TblBulkRunScheduleDays.Single(r => r.BulkRunScheduleId == firstMonday);
        Assert.Equal(new TimeSpan(8, 0, 0), first.StartTime);
    }

    // ─── 6.1: who can book a schedule is a setting, not a derivation ───
    //
    // These four pin the rule rather than the field, which is the point: the
    // bug was never that IsDefault stored the wrong value, it was that nobody
    // could set it and three readers inferred it from "how many clients are
    // linked". So a schedule every client can book, with one client
    // configured on it, read as client-specific everywhere while the booking
    // functions still offered it to everybody. Anisah's 20 Oct schedule was
    // exactly that shape, and operations could see it but not change it.
    //
    // A test that only asserted "IsDefault round-trips" would stay green if
    // someone put the derivation back on the read side, which is the half
    // that was actually visible.

    [Fact]
    public async Task UpsertAsync_create_honours_an_explicit_IsDefault_false()
    {
        // Create hardcoded IsDefault = true, so the New Schedule modal's
        // "Specific clients" option produced a header every client could book
        // that ALSO carried link rows. That is the stray-default shape.
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            seed.TucClients.Add(new TucClient { UcclId = 41, UcclCode = "AAA", UcclName = "Client A" });
            await seed.SaveChangesAsync();

            var create = ValidRequest();
            create.IsDefault = false;
            create.ClientCodes = new List<string> { "AAA" };
            var created = await svc.UpsertAsync(create);

            using var read = CockpitTestHarness.Context(opts);
            var header = read.BulkRunScheduleHeaders.Single(h => h.ScheduleId == created.ScheduleId);
            Assert.False(header.IsDefault);
            Assert.False(created.IsDefault);
        }
    }

    [Fact]
    public async Task UpsertAsync_unset_IsDefault_still_creates_a_default_and_does_not_flip_one()
    {
        // The back-compat half. A caller that has never heard of the field -
        // the legacy POST /api/schedules contract, and every integration on
        // it - must keep getting a default on create, and must not flip the
        // flag on a schedule it edits for some unrelated reason.
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            seed.TucClients.Add(new TucClient { UcclId = 41, UcclCode = "AAA", UcclName = "Client A" });
            await seed.SaveChangesAsync();

            var created = await svc.UpsertAsync(ValidRequest());   // IsDefault unset
            Assert.True(created.IsDefault);

            var turnSpecific = ValidRequest();
            turnSpecific.ScheduleId = created.ScheduleId;
            turnSpecific.IsDefault = false;
            turnSpecific.ClientCodes = new List<string> { "AAA" };
            await svc.UpsertAsync(turnSpecific);

            // Now an edit that says nothing about it. Renaming must not put
            // the schedule back in front of every client.
            var rename = ValidRequest();
            rename.ScheduleId = created.ScheduleId;
            rename.Name = "Renamed Group";
            rename.ClientCodes = new List<string> { "AAA" };
            var renamed = await svc.UpsertAsync(rename);

            Assert.False(renamed.IsDefault);
        }
    }

    [Fact]
    public async Task UpsertAsync_refuses_a_non_default_schedule_with_no_client()
    {
        // Rule 3. A schedule that is neither default nor configured for
        // anybody is bookable by nobody: it does not appear for any client and
        // nothing says why. The guard is on the DESIRED client set, so the
        // case it has to catch is an operator REMOVING the last client from a
        // client-specific schedule, whose link row is still on disk when the
        // check runs.
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            seed.TucClients.Add(new TucClient { UcclId = 41, UcclCode = "AAA", UcclName = "Client A" });
            await seed.SaveChangesAsync();

            var create = ValidRequest();
            create.IsDefault = false;
            create.ClientCodes = new List<string> { "AAA" };
            var created = await svc.UpsertAsync(create);

            var strip = ValidRequest();
            strip.ScheduleId = created.ScheduleId;
            strip.IsDefault = false;
            strip.ClientCodes = new List<string>();     // last chip removed

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.UpsertAsync(strip));
            Assert.Contains("needs at least one client", ex.Message);

            // And the refusal left the schedule alone rather than half-saving.
            using var read = CockpitTestHarness.Context(opts);
            Assert.Single(read.ScheduleClients.Where(c => c.ScheduleId == created.ScheduleId));
        }
    }

    [Fact]
    public async Task ListSummary_reports_IsDefault_from_the_header_not_from_the_client_count()
    {
        // The read half, and the one that was visible to operations. A default
        // schedule with a client configured on it must still read as default:
        // the old inference ("no legacy client and no links") put it in the
        // client-specific bucket, so the list row dropped its "All clients"
        // chip, the type= filter moved it to "shared", and the modal's radio
        // pair selected "Specific clients" on a header that says otherwise.
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            seed.TucClients.Add(new TucClient { UcclId = 41, UcclCode = "AAA", UcclName = "Client A" });
            await seed.SaveChangesAsync();

            var create = ValidRequest();
            create.ClientCodes = new List<string> { "AAA" };   // default WITH a client
            var created = await svc.UpsertAsync(create);

            // And a genuinely client-specific one, so the assertions cannot
            // pass on the DTO's own `IsDefault = true` default. Without the
            // projection carrying the flag, this row reads true and the test
            // fails, which is what makes the pair worth having.
            var specific = ValidRequest();
            specific.Name = "Specific Group";
            specific.IsDefault = false;
            specific.ClientCodes = new List<string> { "AAA" };
            var specificCreated = await svc.UpsertAsync(specific);

            var summaries = await svc.ListSummaryAsync(
                clientId: null, includeClientSpecific: false, includeAllLive: true);

            var row = Assert.Single(summaries.Where(s => s.ScheduleId == created.ScheduleId));
            Assert.True(row.IsDefault);
            Assert.Equal(1, row.ClientCount);          // both facts, independently

            var specificRow = Assert.Single(
                summaries.Where(s => s.ScheduleId == specificCreated.ScheduleId));
            Assert.False(specificRow.IsDefault);
            Assert.Equal(1, specificRow.ClientCount);  // same count, opposite flag

            Assert.True((await svc.GetDetailAsync(created.ScheduleId)).IsDefault);
            Assert.False((await svc.GetDetailAsync(specificCreated.ScheduleId)).IsDefault);
        }
    }

    [Fact]
    public async Task DetachClientAsync_refuses_to_remove_the_last_client_from_a_non_default_schedule()
    {
        // The Clients tab's Remove button calls this endpoint directly rather
        // than going through the upsert, so guarding only the upsert would
        // leave the unbookable state one click away. The same hole exists on
        // the full-replace endpoint, covered below.
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            seed.TucClients.Add(new TucClient { UcclId = 41, UcclCode = "AAA", UcclName = "Client A" });
            seed.TucClients.Add(new TucClient { UcclId = 42, UcclCode = "BBB", UcclName = "Client B" });
            await seed.SaveChangesAsync();

            var create = ValidRequest();
            create.IsDefault = false;
            create.ClientCodes = new List<string> { "AAA", "BBB" };
            var created = await svc.UpsertAsync(create);

            // Two configured, so removing one is fine.
            Assert.Equal(1, await svc.DetachClientAsync(created.ScheduleId, 42));

            // One left, so removing it is not.
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.DetachClientAsync(created.ScheduleId, 41));
            Assert.Contains("only client", ex.Message);

            using var read = CockpitTestHarness.Context(opts);
            Assert.Single(read.ScheduleClients.Where(c => c.ScheduleId == created.ScheduleId));
        }
    }

    [Fact]
    public async Task DetachClientAsync_allows_removing_the_last_client_from_a_default_schedule()
    {
        // The other half of the same rule, and the one that must NOT be
        // refused: a client configured on a default schedule is an extra, not
        // the thing that makes it bookable, so removing it is ordinary. A
        // guard written as "never remove the last client" would break this.
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            seed.TucClients.Add(new TucClient { UcclId = 41, UcclCode = "AAA", UcclName = "Client A" });
            await seed.SaveChangesAsync();

            var create = ValidRequest();
            create.ClientCodes = new List<string> { "AAA" };   // default WITH a client
            var created = await svc.UpsertAsync(create);

            Assert.Equal(1, await svc.DetachClientAsync(created.ScheduleId, 41));

            using var read = CockpitTestHarness.Context(opts);
            Assert.Empty(read.ScheduleClients.Where(c => c.ScheduleId == created.ScheduleId));
            Assert.True(read.BulkRunScheduleHeaders.Single(h => h.ScheduleId == created.ScheduleId).IsDefault);
        }
    }

    [Fact]
    public async Task ReplaceClientsAsync_refuses_to_empty_a_non_default_schedule()
    {
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            seed.TucClients.Add(new TucClient { UcclId = 41, UcclCode = "AAA", UcclName = "Client A" });
            await seed.SaveChangesAsync();

            var create = ValidRequest();
            create.IsDefault = false;
            create.ClientCodes = new List<string> { "AAA" };
            var created = await svc.UpsertAsync(create);

            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.ReplaceClientsAsync(created.ScheduleId, new List<int>()));
            Assert.Contains("needs at least one client", ex.Message);
        }
    }

    // ─── M4 / B4 (2026-11-10): day rows whose delivery zones differ ───
    //
    // Zones hang off DAY rows, and the detail modal showed only rows[0]'s set.
    // Urgent prod has headers whose days carry different active zones (2154,
    // 2746, 2761 across weekdays, VB3). Saving such a header wrote Monday's set
    // to every day, silently changing where the other days deliver. The fix is
    // to SHOW the difference and refuse a zone save unless the caller says the
    // set applies to all days. Zones are never merged across days.

    /// <summary>Mon + Tue schedule (Mon zones {1 active, 2 inactive}), then
    /// Tuesday's zones replaced with {3 active}.</summary>
    private async Task<(ScheduleService Svc, DbContextOptions<DespatchContext> Opts, int ScheduleId)>
        NewScheduleWithDifferentTuesdayZonesAsync()
    {
        var svc = NewSvcWithSeed(out var seed, out var opts);
        using (seed)
        {
            var created = await svc.UpsertAsync(ValidRequest());
            var tuesdayId = created.DayWindows.Single(d => d.DayOfWeek == 2).Id!.Value;
            seed.BulkZoneSchedules.RemoveRange(seed.BulkZoneSchedules.Where(z => z.ScheduleId == tuesdayId));
            seed.BulkZoneSchedules.Add(new BulkZoneSchedule { ScheduleId = tuesdayId, Zone = 3, Active = true });
            await seed.SaveChangesAsync();
            return (svc, opts, created.ScheduleId);
        }
    }

    private static List<int> ActiveZonesOn(DbContextOptions<DespatchContext> opts, int scheduleId, int dayOfWeek)
    {
        using var read = CockpitTestHarness.Context(opts);
        var dayId = read.TblBulkRunScheduleDays
            .Single(r => r.ScheduleId == scheduleId && r.DayOfWeek == dayOfWeek).BulkRunScheduleId;
        return read.BulkZoneSchedules
            .Where(z => z.ScheduleId == dayId && z.Active == true)
            .Select(z => z.Zone).OrderBy(z => z).ToList();
    }

    [Fact]
    public async Task GetDetail_reports_which_days_have_which_zones_when_they_differ()
    {
        var (svc, _, scheduleId) = await NewScheduleWithDifferentTuesdayZonesAsync();

        var dto = await svc.GetDetailAsync(scheduleId);

        Assert.True(dto.ZonesDifferByDay);
        Assert.Equal(new[] { 1 }, dto.DayZoneSets.Single(d => d.DayOfWeek == 1).ActiveZones);
        Assert.Equal(new[] { 3 }, dto.DayZoneSets.Single(d => d.DayOfWeek == 2).ActiveZones);
    }

    [Fact]
    public async Task GetDetail_does_not_flag_days_that_differ_only_in_inactive_zones()
    {
        // An inactive zone row gates nothing, so {1 active, 2 inactive} and
        // {1 active} are the same delivery coverage.
        var svc = NewSvcWithSeed(out var seed, out _);
        using (seed)
        {
            var created = await svc.UpsertAsync(ValidRequest());
            var tuesdayId = created.DayWindows.Single(d => d.DayOfWeek == 2).Id!.Value;
            seed.BulkZoneSchedules.RemoveRange(
                seed.BulkZoneSchedules.Where(z => z.ScheduleId == tuesdayId && z.Zone == 2));
            await seed.SaveChangesAsync();

            var dto = await svc.GetDetailAsync(created.ScheduleId);

            Assert.False(dto.ZonesDifferByDay);
        }
    }

    [Fact]
    public async Task UpsertAsync_refuses_a_zone_save_that_would_flatten_days_with_different_zones()
    {
        var (svc, opts, scheduleId) = await NewScheduleWithDifferentTuesdayZonesAsync();

        var edit = ValidRequest();
        edit.ScheduleId = scheduleId;
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpsertAsync(edit));
        Assert.Contains("different delivery zones", ex.Message);

        Assert.Equal(new[] { 1 }, ActiveZonesOn(opts, scheduleId, 1));
        Assert.Equal(new[] { 3 }, ActiveZonesOn(opts, scheduleId, 2));
    }

    [Fact]
    public async Task UpsertAsync_applies_one_zone_set_to_every_day_when_the_caller_chooses_it()
    {
        var (svc, opts, scheduleId) = await NewScheduleWithDifferentTuesdayZonesAsync();

        var edit = ValidRequest();
        edit.ScheduleId = scheduleId;
        edit.ApplyZonesToAllDays = true;
        await svc.UpsertAsync(edit);

        Assert.Equal(new[] { 1 }, ActiveZonesOn(opts, scheduleId, 1));
        Assert.Equal(new[] { 1 }, ActiveZonesOn(opts, scheduleId, 2));
    }

    [Fact]
    public async Task UpsertAsync_without_zones_leaves_each_days_zones_alone()
    {
        // The modal omits Zones on such a header unless the operator chose a
        // set for all days, so other edits still save.
        var (svc, opts, scheduleId) = await NewScheduleWithDifferentTuesdayZonesAsync();

        var edit = ValidRequest();
        edit.ScheduleId = scheduleId;
        edit.Zones = null;
        edit.Description = "edited";
        await svc.UpsertAsync(edit);

        Assert.Equal(new[] { 1 }, ActiveZonesOn(opts, scheduleId, 1));
        Assert.Equal(new[] { 3 }, ActiveZonesOn(opts, scheduleId, 2));
    }

    // ---- S3: inactive clients in the schedule client picker ----------------

    [Fact]
    public async Task SearchClientsAsync_hides_inactive_accounts_by_default()
    {
        // Every other picker on the endpoint (overrides page, legacy modals)
        // still wants active accounts only, so the old behaviour is the default.
        var svc = NewSvcWithSeed(out var seed, out _);
        using (seed)
        {
            seed.TucClients.Add(new TucClient { UcclId = 41, UcclCode = "AAA", UcclName = "Client A", UcclActive = true });
            seed.TucClients.Add(new TucClient { UcclId = 42, UcclCode = "BBB", UcclName = "Client B", UcclActive = false });
            await seed.SaveChangesAsync();

            var hits = await svc.SearchClientsAsync(null, 50);

            Assert.Equal(new[] { 41 }, hits.Select(h => h.Id));
        }
    }

    [Fact]
    public async Task SearchClientsAsync_lists_inactive_accounts_labelled_when_asked()
    {
        // A schedule can be linked to an account that is currently inactive
        // (seasonal clients). The schedule modal must be able to find it, and
        // the operator must be able to tell it is inactive.
        var svc = NewSvcWithSeed(out var seed, out _);
        using (seed)
        {
            seed.TucClients.Add(new TucClient { UcclId = 41, UcclCode = "AAA", UcclName = "Client A", UcclActive = true });
            seed.TucClients.Add(new TucClient { UcclId = 42, UcclCode = "BBB", UcclName = "Client B", UcclActive = false });
            await seed.SaveChangesAsync();

            var hits = await svc.SearchClientsAsync(null, 50, includeInactive: true);

            Assert.Equal("AAA Client A", hits.Single(h => h.Id == 41).Name);
            Assert.Equal("BBB Client B (inactive)", hits.Single(h => h.Id == 42).Name);
        }
    }

    // ---- S2: schedule list search matches linked client codes --------------

    [Fact]
    public async Task ScheduleIdsLinkedToClientCodeAsync_finds_schedules_by_any_linked_client_code()
    {
        // The list row only carries the first 3 linked codes, so the match has
        // to come from the link table, not the row, or a schedule's 4th client
        // could never be searched for.
        var svc = NewSvcWithSeed(out var seed, out _);
        using (seed)
        {
            seed.TucClients.Add(new TucClient { UcclId = 41, UcclCode = "ACME", UcclName = "Acme Ltd" });
            seed.TucClients.Add(new TucClient { UcclId = 42, UcclCode = "BOLT", UcclName = "Bolt Co" });
            await seed.SaveChangesAsync();

            var create = ValidRequest();
            create.IsDefault = false;
            create.ClientCodes = new List<string> { "ACME" };
            var created = await svc.UpsertAsync(create);

            Assert.Equal(new[] { created.ScheduleId }, await svc.ScheduleIdsLinkedToClientCodeAsync("cme"));
            Assert.Empty(await svc.ScheduleIdsLinkedToClientCodeAsync("BOLT"));
        }
    }
}
