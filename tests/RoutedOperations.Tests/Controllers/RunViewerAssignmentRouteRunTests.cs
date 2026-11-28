// Cheetah R2 + fix round 1 F1 (2026-11-28). CAPS route runs (RunId =
// -RouteId) reach the run procs with their date instead of being refused
// (contract v2, migration 20261128100500: the four run procs take an
// optional last @RunDate and resolve a route run's jobs themselves). On a
// route run Pre-assign / Re-assign / drag go to RVW_stpTransferRun, which
// restores and despatches and returns one outcome row per job; a normal run
// keeps RVW_stpPreAssignRun (status 18, no despatch).
//
// InMemory cannot EXEC, so the context points at SQL Server with an
// interceptor that suppresses the connection, records each command and
// hands back a canned outcome table for the reader call.
// Moved from Services/RouteViewer/RouteViewerAssignmentRestoreFirstTests.cs (S8).
using System.Data;
using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.API.Controllers;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;
using RoutedOperations.Tests.Services.RouteViewer;

namespace RoutedOperations.Tests.Controllers;

public class RunViewerAssignmentRouteRunTests
{

    private static readonly DateTime RunDate = new(2026, 11, 30, 14, 5, 0);

    private sealed class CaptureExec : DbCommandInterceptor, IDbConnectionInterceptor
    {
        public List<(string Sql, Dictionary<string, object?> Args)> Commands { get; } = new();

        /// <summary>What RVW_stpTransferRun's route branch "returns".</summary>
        public DataTable Outcomes { get; } = NewOutcomeTable();

        private void Record(DbCommand command) =>
            Commands.Add((command.CommandText, command.Parameters.Cast<DbParameter>()
                .ToDictionary(p => p.ParameterName, p => p.Value is DBNull ? null : p.Value)));

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Record(command);
            return ValueTask.FromResult(InterceptionResult<DbDataReader>.SuppressWithResult(new DataTableReader(Outcomes)));
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            Record(command);
            return ValueTask.FromResult(InterceptionResult<int>.SuppressWithResult(0));
        }

        public ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
            => ValueTask.FromResult(InterceptionResult.Suppress());

        public InterceptionResult ConnectionOpening(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result) => InterceptionResult.Suppress();
    }

    private static DataTable NewOutcomeTable()
    {
        var t = new DataTable();
        t.Columns.Add("JobID", typeof(int));
        t.Columns.Add("JobNumber", typeof(string));
        t.Columns.Add("Outcome", typeof(string));
        t.Columns.Add("NowUnassigned", typeof(bool));
        return t;
    }

    private static (RunViewerAssignmentController ctl, CaptureExec capture) NewSqlCtl()
    {
        var capture = new CaptureExec();
        var opts = new DbContextOptionsBuilder<DespatchContext>()
            .UseSqlServer("Server=unused;Database=unused;Trusted_Connection=True;")
            .AddInterceptors(capture)
            .Options;
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var svc = new RouteViewerAssignmentService(RouteViewerTestHarness.Factory(opts), resolver,
            Substitute.For<INpScopeGuard>(), RoutedOperations.Tests.Branches.BranchTestDoubles.Unrestricted(),
            NullLogger<RouteViewerAssignmentService>.Instance);
        var ctl = new RunViewerAssignmentController(svc);
        ControllerTestHarness.AttachHttpContext(ctl);
        return (ctl, capture);
    }

    private static string? BadMessage(IActionResult result)
    {
        var bad = Assert.IsType<BadRequestObjectResult>(result);
        return bad.Value!.GetType().GetProperty("message")!.GetValue(bad.Value) as string;
    }

    private static BulkAssignmentResult OkOutcome(IActionResult result)
    {
        var ok = Assert.IsType<OkObjectResult>(result);
        return Assert.IsType<BulkAssignmentResult>(ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value));
    }

    [Fact]
    public async Task Route_run_re_assign_restores_and_despatches_through_transfer_run_not_pre_assign()
    {
        // F1 (Kevin option A): on a route run the new driver gets the jobs now.
        // RVW_stpPreAssignRun would only set status 18 and nothing reaches the
        // phone; RVW_stpTransferRun restores off the old driver then despatches.
        var (ctl, capture) = NewSqlCtl();
        capture.Outcomes.Rows.Add(1, "P1", "Moved", false);
        capture.Outcomes.Rows.Add(2, "P2", "Moved", false);

        var outcome = OkOutcome(await ctl.PreAssignRun(new PreAssignRunRequest { RunId = -512, FromCourierCode = "22", ToCourierCode = "2", RunDate = RunDate }));

        var (sql, args) = Assert.Single(capture.Commands);
        Assert.Equal("EXEC dbo.RVW_stpTransferRun @RunID = @RunID, @FromCourierCode = @FromCourierCode, @ToCourierCode = @ToCourierCode, @RunDate = @RunDate", sql.TrimEnd()); // SqlQueryRaw adds a newline, not a wrapper
        Assert.Equal(-512, args["@RunID"]);
        Assert.Equal("22", args["@FromCourierCode"]);
        Assert.Equal("2", args["@ToCourierCode"]);
        // Date only: the proc compares against the route's job date.
        Assert.Equal(RunDate.Date, args["@RunDate"]);
        // "Moved 2 jobs from 22 to 2."
        Assert.Equal(2, outcome.Moved);
        Assert.Equal(2, outcome.Succeeded);
        Assert.Equal(new[] { "22" }, outcome.FromCourierCodes);
        Assert.Equal("2", outcome.TargetCode);
    }

    [Fact]
    public async Task Route_run_pre_assign_of_an_unassigned_run_despatches_and_reports_skipped_and_failed_jobs()
    {
        var (ctl, capture) = NewSqlCtl();
        capture.Outcomes.Rows.Add(3, "P3", "Assigned", false);
        capture.Outcomes.Rows.Add(4, "P4", "Skipped", false);
        capture.Outcomes.Rows.Add(31, "P31MR", "Failed", true);

        var outcome = OkOutcome(await ctl.PreAssignRun(new PreAssignRunRequest { RunId = -512, ToCourierCode = "2", RunDate = RunDate }));

        var (sql, args) = Assert.Single(capture.Commands);
        Assert.StartsWith("EXEC dbo.RVW_stpTransferRun ", sql);
        Assert.Null(args["@FromCourierCode"]);
        Assert.Equal(1, outcome.Succeeded);
        Assert.Equal(0, outcome.Moved);
        Assert.Empty(outcome.FromCourierCodes);
        var skipped = Assert.Single(outcome.Rejected);
        Assert.Equal("P4", skipped.JobNumber);
        Assert.Equal("Job is already completed.", skipped.Reason);
        // F3: the toast says "P31MR failed and is now unassigned".
        Assert.Equal(1, outcome.Failed);
        var failed = Assert.Single(outcome.FailedJobs);
        Assert.Equal("P31MR", failed.JobNumber);
        Assert.True(failed.NowUnassigned);
    }

    [Fact]
    public async Task Route_run_re_assign_to_the_same_driver_restores_and_despatches_again_as_a_resend()
    {
        // Kevin 2026-11-28 (fix round 3, replaces round 2's no-op): re-assign to
        // the same driver is how ops resend jobs the phone missed, so it must run
        // RVW_stpTransferRun (restore: void on the phone, then despatch again).
        var (ctl, capture) = NewSqlCtl();
        capture.Outcomes.Rows.Add(1, "P1", "Moved", false);
        capture.Outcomes.Rows.Add(2, "P2", "Moved", false);

        var outcome = OkOutcome(await ctl.PreAssignRun(new PreAssignRunRequest { RunId = -512, FromCourierCode = " 512 ", ToCourierCode = "512", RunDate = RunDate }));

        var (sql, args) = Assert.Single(capture.Commands);
        Assert.StartsWith("EXEC dbo.RVW_stpTransferRun ", sql);
        // From must reach the proc: a null From skips the restore and nothing is re-sent.
        Assert.Equal("512", args["@FromCourierCode"]);
        Assert.Equal("512", args["@ToCourierCode"]);
        // The proc reports "Moved" for each job; a resend is a success, not a
        // move, so the toast reads "Assigned 2 jobs to 512." not "Moved from 512 to 512".
        Assert.Equal(2, outcome.Succeeded);
        Assert.Equal(0, outcome.Moved);
        Assert.Empty(outcome.FromCourierCodes);
        Assert.Equal(0, outcome.Failed);
        Assert.Equal("512", outcome.TargetCode);
    }

    [Fact]
    public async Task Route_run_transfer_to_the_void_code_counts_voided_jobs_as_done_not_failed()
    {
        // Fix round 2: transfer to 800 voids; the proc reports Voided, which
        // must not read as "failed and now unassigned" in the toast.
        var (ctl, capture) = NewSqlCtl();
        capture.Outcomes.Rows.Add(1, "P1", "Voided", true);

        var outcome = OkOutcome(await ctl.PreAssignRun(new PreAssignRunRequest { RunId = -512, FromCourierCode = "512", ToCourierCode = "800", RunDate = RunDate }));

        Assert.Single(capture.Commands);
        Assert.Equal(1, outcome.Succeeded);
        Assert.Equal(0, outcome.Failed);
        Assert.Empty(outcome.FailedJobs);
    }

    [Fact]
    public async Task Route_run_transfer_unassign_and_release_each_reach_their_proc_with_the_date()
    {
        var (ctl, capture) = NewSqlCtl();

        Assert.IsType<OkObjectResult>(await ctl.TransferRun(new TransferRunRequest { RunId = -512, FromCourierCode = "22", ToCourierCode = "2", RunDate = RunDate }));
        Assert.IsType<OkObjectResult>(await ctl.UnAssignRun(new UnAssignRunRequest { RunId = -512, CourierCode = "22", RunDate = RunDate }));
        Assert.IsType<OkObjectResult>(await ctl.ReleaseRun(new ReleaseRunRequest { RunId = -512, CourierCode = "22", RunDate = RunDate }));

        Assert.Equal(
            new[]
            {
                "EXEC dbo.RVW_stpTransferRun @RunID = @RunID, @FromCourierCode = @FromCourierCode, @ToCourierCode = @ToCourierCode, @RunDate = @RunDate",
                "EXEC dbo.RVW_stpUnAssignRun @RunID = @RunID, @CourierCode = @CourierCode, @RunDate = @RunDate",
                "EXEC dbo.RVW_stpReleaseRun @RunID = @RunID, @CourierCode = @CourierCode, @RunDate = @RunDate",
            },
            capture.Commands.Select(c => c.Sql));
        Assert.All(capture.Commands, c => Assert.Equal(RunDate.Date, c.Args["@RunDate"]));
    }

    [Fact]
    public async Task Normal_run_pre_assign_is_unchanged_status_18_proc_no_run_date_no_despatch()
    {
        // F1 is route runs only: a normal run still pre-assigns (status 18,
        // nothing sent until Release). A tenant without 20261128100500 has no
        // @RunDate parameter; sending one for a real run would break it.
        var (ctl, capture) = NewSqlCtl();

        var result = await ctl.PreAssignRun(new PreAssignRunRequest { RunId = 41, FromCourierCode = "C7", ToCourierCode = "K9", RunDate = RunDate });

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Equal("ok", ok.Value!.GetType().GetProperty("response")!.GetValue(ok.Value));
        var (sql, args) = Assert.Single(capture.Commands);
        Assert.Equal("EXEC dbo.RVW_stpPreAssignRun @RunID = @RunID, @FromCourierCode = @FromCourierCode, @ToCourierCode = @ToCourierCode", sql);
        Assert.False(args.ContainsKey("@RunDate"));
    }

    [Fact]
    public async Task Route_run_without_a_date_is_refused_before_any_proc_runs()
    {
        var (ctl, capture) = NewSqlCtl();

        var result = await ctl.ReleaseRun(new ReleaseRunRequest { RunId = -512, CourierCode = "22" });

        Assert.Equal("Pick a run date first.", BadMessage(result));
        Assert.Empty(capture.Commands);
    }

    [Fact]
    public async Task RunId_zero_is_refused_in_plain_english()
    {
        var (ctl, capture) = NewSqlCtl();

        Assert.Equal("Pick a run first.", BadMessage(await ctl.PreAssignRun(new PreAssignRunRequest { RunId = 0, ToCourierCode = "2" })));
        Assert.Equal("Pick a run first.", BadMessage(await ctl.TransferRun(new TransferRunRequest { RunId = 0, ToCourierCode = "2" })));
        Assert.Equal("Pick a run first.", BadMessage(await ctl.UnAssignRun(new UnAssignRunRequest { RunId = 0, CourierCode = "2" })));
        Assert.Equal("Pick a run first.", BadMessage(await ctl.ReleaseRun(new ReleaseRunRequest { RunId = 0, CourierCode = "2" })));
        Assert.Empty(capture.Commands);
    }

    [Fact]
    public async Task Original_run_order_is_refused_on_a_route_run()
    {
        var (ctl, capture) = NewSqlCtl();

        var result = await ctl.TransferOriginalRunOrder(new TransferOriginalRunOrderRequest { RunId = -512, ToCourierCode = "2" });

        Assert.Equal("Original run order is not kept for route runs.", BadMessage(result));
        Assert.Empty(capture.Commands);
    }
}
