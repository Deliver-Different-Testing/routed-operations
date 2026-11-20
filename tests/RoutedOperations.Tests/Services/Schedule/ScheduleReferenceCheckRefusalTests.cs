using System.Data.Common;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.Schedule;
using RoutedOperations.Core.Application.Services.Schedule;
using RoutedOperations.Core.Application.Utilities;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using RoutedOperations.Tests.Controllers;

namespace RoutedOperations.Tests.Services.Schedule;

/// <summary>
/// F1, Marcus 18 Nov (Urgent prod, schedule #71): unticking a weekday and
/// saving returned a bare "HTTP 500" because the day-row reference check
/// (ReferencedDayRowIdsAsync) hit a missing SELECT grant on dbo.ShopWindow.
///
/// The rule these tests hold: when that check cannot run, the save is
/// REFUSED in plain words and nothing is written. It must never fall through
/// to "nothing references this row", because tblRouteSchedule cascades on
/// delete and would silently unlink a route (spec 2.3.5).
///
/// The Sqlite harness cannot run the SQL Server raw query, so the failure is
/// injected with an interceptor on the reference read the Sqlite branch
/// issues (the tblBulkJob ScheduleID lookup). The catch covers both branches.
/// </summary>
public class ScheduleReferenceCheckRefusalTests : IDisposable
{
    private readonly List<DbConnection> _connections = new();
    public void Dispose() { foreach (var c in _connections) c.Dispose(); }

    /// <summary>Throws the way a denied SELECT does, but only once armed and
    /// only for the reference read, so seeding and the earlier steps of the
    /// save run normally.</summary>
    private sealed class ReferenceReadFails : DbCommandInterceptor
    {
        public bool Armed { get; set; }
        public Func<Exception> Make { get; set; } =
            () => new SqliteException("The SELECT permission was denied on the object 'ShopWindow'.", 229);

        private void ThrowIfReferenceRead(DbCommand command)
        {
            if (!Armed) return;
            var sql = command.CommandText;
            if (sql.Contains("\"tblBulkJob\"", StringComparison.OrdinalIgnoreCase)
                && sql.Contains("ScheduleID", StringComparison.OrdinalIgnoreCase))
                throw Make();
        }

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            ThrowIfReferenceRead(command);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            ThrowIfReferenceRead(command);
            return ValueTask.FromResult(result);
        }
    }

    private (ScheduleService Svc, DbContextOptions<DespatchContext> Opts, ReferenceReadFails Fail) NewSvc()
    {
        var (baseOpts, connection) = CockpitTestHarness.NewSqliteOptions();
        _connections.Add(connection);
        var fail = new ReferenceReadFails();
        var opts = new DbContextOptionsBuilder<DespatchContext>(baseOpts).AddInterceptors(fail).Options;
        using (var init = CockpitTestHarness.Context(baseOpts)) { }
        var accessor = new HttpContextAccessor();
        var cache = new TenantScopedCache(new MemoryCache(new MemoryCacheOptions()), accessor);
        var svc = new ScheduleService(
            CockpitTestHarness.Factory(opts),
            NullLogger<ScheduleService>.Instance,
            cache,
            Substitute.For<IScheduleConverter>(),
            accessor);
        return (svc, baseOpts, fail);
    }

    private static ScheduleGroupUpsertRequest MonTue() => new()
    {
        Name = "Afternoon Delivery",
        RegionId = 1,
        DayWindows = new List<DayWindowUpsertRequest>
        {
            new() { DayOfWeek = 1, StartTime = "12:00", EndTime = "17:00", CutoffDay = 1, CutoffTime = "10:00" },
            new() { DayOfWeek = 2, StartTime = "12:00", EndTime = "17:00", CutoffDay = 2, CutoffTime = "10:00" },
        },
    };

    private static ScheduleGroupUpsertRequest MondayOnly(int scheduleId)
    {
        var req = MonTue();
        req.ScheduleId = scheduleId;
        req.DayWindows = new List<DayWindowUpsertRequest>
        {
            new() { DayOfWeek = 1, StartTime = "12:00", EndTime = "17:00", CutoffDay = 1, CutoffTime = "10:00" },
        };
        return req;
    }

    private static List<(int Id, short Day, TimeSpan? Start)> DayRows(DbContextOptions<DespatchContext> opts, int scheduleId)
    {
        using var read = CockpitTestHarness.Context(opts);
        return read.TblBulkRunScheduleDays.Where(r => r.ScheduleId == scheduleId)
            .OrderBy(r => r.DayOfWeek).ToList()
            .Select(r => (r.BulkRunScheduleId, r.DayOfWeek, r.StartTime)).ToList();
    }

    [Fact]
    public async Task Unticking_a_day_when_the_reference_check_fails_is_refused_in_plain_words_and_writes_nothing()
    {
        var (svc, opts, fail) = NewSvc();
        var created = await svc.UpsertAsync(MonTue());
        var before = DayRows(opts, created.ScheduleId);
        Assert.Equal(2, before.Count);

        fail.Armed = true;
        var ex = await Assert.ThrowsAsync<ScheduleReferenceCheckUnavailableException>(
            () => svc.UpsertAsync(MondayOnly(created.ScheduleId)));

        Assert.Equal(
            "This day could not be removed because the system could not check what still uses it. Nothing was saved.",
            ex.Message);
        Assert.NotEqual(Guid.Empty, ex.MessageId);
        // The underlying database error is kept for the log, not shown.
        Assert.IsAssignableFrom<DbException>(ex.InnerException);

        // Nothing written: Tuesday is still there, unchanged.
        Assert.Equal(before, DayRows(opts, created.ScheduleId));
    }

    [Fact]
    public async Task Controller_returns_400_with_the_message_and_messageId_not_a_500()
    {
        var (svc, opts, fail) = NewSvc();
        var created = await svc.UpsertAsync(MonTue());
        var ctl = new SchedulesV2Controller(svc,
            new ScheduleOverrideService(CockpitTestHarness.Factory(opts), NullLogger<ScheduleOverrideService>.Instance));
        ControllerTestHarness.AttachHttpContext(ctl);

        fail.Armed = true;
        var result = await ctl.Update(created.ScheduleId, MondayOnly(created.ScheduleId));

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var body = bad.Value!;
        var message = (string?)body.GetType().GetProperty("message")?.GetValue(body);
        var messageId = body.GetType().GetProperty("messageId")?.GetValue(body);
        Assert.Equal(
            "This day could not be removed because the system could not check what still uses it. Nothing was saved.",
            message);
        Assert.IsType<Guid>(messageId);
        Assert.NotEqual(Guid.Empty, (Guid)messageId!);
    }

    /// <summary>m1 (review 19 Nov): a pool timeout or a command timeout is not
    /// a DbException, but it is still "the check could not run". It must get
    /// the same plain refusal, not the raw ADO text.</summary>
    [Theory]
    [InlineData("pool")]
    [InlineData("timeout")]
    public async Task A_non_database_failure_of_the_check_is_the_same_plain_refusal(string kind)
    {
        var (svc, opts, fail) = NewSvc();
        var created = await svc.UpsertAsync(MonTue());
        var before = DayRows(opts, created.ScheduleId);

        fail.Make = kind == "pool"
            ? () => new InvalidOperationException("Timeout expired. The timeout period elapsed prior to obtaining a connection from the pool.")
            : () => new TimeoutException("The operation has timed out.");
        fail.Armed = true;
        var ex = await Assert.ThrowsAsync<ScheduleReferenceCheckUnavailableException>(
            () => svc.UpsertAsync(MondayOnly(created.ScheduleId)));

        Assert.Equal(ScheduleReferenceCheckUnavailableException.UserMessage, ex.Message);
        Assert.Equal(before, DayRows(opts, created.ScheduleId));
    }

    /// <summary>A cancelled request is the caller going away, not a failed
    /// check, so it stays a cancellation (and still writes nothing).</summary>
    [Fact]
    public async Task A_cancelled_check_stays_a_cancellation()
    {
        var (svc, opts, fail) = NewSvc();
        var created = await svc.UpsertAsync(MonTue());
        var before = DayRows(opts, created.ScheduleId);

        fail.Make = () => new OperationCanceledException();
        fail.Armed = true;
        var ex = await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => svc.UpsertAsync(MondayOnly(created.ScheduleId)));

        Assert.IsNotType<ScheduleReferenceCheckUnavailableException>(ex);
        Assert.Equal(before, DayRows(opts, created.ScheduleId));
    }

    [Fact]
    public async Task With_the_check_working_a_day_a_job_still_uses_is_kept_not_deleted()
    {
        // Spec test 3: the refusal must not change the normal path. A day row
        // something still points at is blanked and kept; only an unreferenced
        // one is deleted.
        var (svc, opts, _) = NewSvc();
        var created = await svc.UpsertAsync(MonTue());
        var tuesdayId = DayRows(opts, created.ScheduleId).Single(r => r.Day == 2).Id;
        using (var plant = CockpitTestHarness.Context(opts))
        {
            var date = new DateTime(2026, 11, 18);
            plant.TblBulkJobs.Add(new TblBulkJob
            {
                JobNumber = "J-71", ClientId = 1, ClientCode = "C",
                BookDate = date, BookTime = date, JobStatus = 0, Speed = 1,
                FromAddress = "F", ToAddress = "T", RunOrder = 1,
                ScheduleId = tuesdayId,
            });
            await plant.SaveChangesAsync();
        }

        await svc.UpsertAsync(MondayOnly(created.ScheduleId));

        var after = DayRows(opts, created.ScheduleId);
        var tuesday = Assert.Single(after, r => r.Id == tuesdayId);
        Assert.Null(tuesday.Start);
    }

    // ─── r5 (round 2 review, 20 Nov): every caller of the save path ──────

    private static (string Message, object MessageId) Body(IActionResult result)
    {
        var body = Assert.IsType<BadRequestObjectResult>(result).Value!;
        return ((string?)body.GetType().GetProperty("message")?.GetValue(body) ?? "",
            body.GetType().GetProperty("messageId")?.GetValue(body)!);
    }

    [Fact]
    public async Task Legacy_put_returns_the_refusal_with_its_messageId()
    {
        // PUT /api/schedules (SchedulesController.Upsert) drives the same
        // save, so an operator on it must get the same reference to quote.
        var (svc, _, fail) = NewSvc();
        var created = await svc.UpsertAsync(MonTue());
        var ctl = new SchedulesController(svc);
        ControllerTestHarness.AttachHttpContext(ctl);

        fail.Armed = true;
        var (message, messageId) = Body(await ctl.Upsert(MondayOnly(created.ScheduleId)));

        Assert.Equal(ScheduleReferenceCheckUnavailableException.UserMessage, message);
        Assert.NotEqual(Guid.Empty, Assert.IsType<Guid>(messageId));
    }

    [Fact]
    public void The_shared_refusal_body_carries_the_messageId_only_for_the_check_refusal()
    {
        // POST /api/v2/schedules (Create) forces ScheduleId to null, so it
        // never drops a day row and cannot reach the check through the real
        // save. It still answers through this helper, which is what is
        // pinned here, together with "an ordinary refusal has no id".
        var id = Guid.NewGuid();
        var f1 = ScheduleSaveRefusal.Body(new ScheduleReferenceCheckUnavailableException(id, new Exception("x")));
        Assert.Equal(id, f1.GetType().GetProperty("messageId")?.GetValue(f1));
        Assert.Equal(ScheduleReferenceCheckUnavailableException.UserMessage, f1.GetType().GetProperty("message")?.GetValue(f1));

        var plain = ScheduleSaveRefusal.Body(new InvalidOperationException("Schedule id 9 not found or retired."));
        Assert.Null(plain.GetType().GetProperty("messageId"));
        Assert.Equal("Schedule id 9 not found or retired.", plain.GetType().GetProperty("message")?.GetValue(plain));
    }
}
