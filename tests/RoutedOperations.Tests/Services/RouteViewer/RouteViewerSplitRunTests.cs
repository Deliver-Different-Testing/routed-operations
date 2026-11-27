// #311 / #326: a run whose jobs sit with more than one courier comes back
// from RVW_stpBulkRuns_2 as one row per courier (plus a NULL-courier row
// for the jobs nobody holds yet). The app has to keep those rows apart, so
// each row must carry the courier it stands for, and fetching a row's jobs
// must be able to ask for "only the unassigned ones" for the NULL row.
// Without that, clicking the unassigned half of a split run lists every job
// on the run, and Assign Route on it re-assigns jobs another driver already
// holds.
//
// InMemory cannot run stored procedures, so these tests point the context at
// SQL Server with an interceptor that suppresses the connection, records the
// command and hands back a canned result set.
using System.Data;
using System.Data.Common;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerSplitRunTests
{
    private sealed class CannedSql : DbCommandInterceptor, IDbConnectionInterceptor
    {
        // Snapshot text + parameters: EF clears command.Parameters once the
        // command has run.
        public readonly List<(string Text, Dictionary<string, object?> Params)> Commands = new();
        public Func<string, DataTable> Result = _ => new DataTable();

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Commands.Add((command.CommandText, command.Parameters.Cast<DbParameter>()
                .ToDictionary(x => x.ParameterName, x => (object?)x.Value)));
            return ValueTask.FromResult(InterceptionResult<DbDataReader>.SuppressWithResult(
                Result(command.CommandText).CreateDataReader()));
        }

        public ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
            => ValueTask.FromResult(InterceptionResult.Suppress());

        public InterceptionResult ConnectionOpening(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result) => InterceptionResult.Suppress();
    }

    private static (RouteViewerRunService sut, CannedSql sql) NewSvc()
    {
        var sql = new CannedSql();
        var opts = new DbContextOptionsBuilder<DespatchContext>()
            .UseSqlServer("Server=unused;Database=unused;Trusted_Connection=True;")
            .AddInterceptors(sql)
            .Options;
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext());
        var sut = new RouteViewerRunService(factory, resolver, Substitute.For<INpScopeGuard>(),
            RoutedOperations.Tests.Branches.BranchTestDoubles.Unrestricted(),
            new SqlTimeZoneNormalizer(factory), accessor, NullLogger<RouteViewerRunService>.Instance);
        return (sut, sql);
    }

    [Fact]
    public async Task Unassigned_half_of_a_split_run_asks_the_sp_for_unassigned_jobs_only()
    {
        var (sut, sql) = NewSvc();
        // Only the command matters here; the canned empty result set has no
        // columns, so materialising it may throw afterwards.
        await Record.ExceptionAsync(() => sut.GetBulkRunJobsAsync(41, new BulkRunJobsRequest
        {
            RunDate = new DateTime(2099, 1, 5),
            UnassignedOnly = true,
        }));

        var cmd = Assert.Single(sql.Commands);
        Assert.Contains("@UnassignedOnly = @UnassignedOnly", cmd.Text);
        Assert.Equal(true, cmd.Params["@UnassignedOnly"]);
    }

    [Fact]
    public async Task A_normal_run_fetch_does_not_restrict_to_unassigned_jobs()
    {
        var (sut, sql) = NewSvc();
        await Record.ExceptionAsync(() => sut.GetBulkRunJobsAsync(41, new BulkRunJobsRequest
        {
            RunDate = new DateTime(2099, 1, 5),
            CourierId = 7,
        }));

        var cmd = Assert.Single(sql.Commands);
        Assert.Equal(false, cmd.Params["@UnassignedOnly"]);
        Assert.Equal(7, cmd.Params["@CourierID"]);
    }

    [Fact]
    public async Task Each_courier_row_of_a_split_run_carries_its_own_courier_id()
    {
        var (sut, sql) = NewSvc();
        sql.Result = text => text.Contains("RVW_stpBulkRuns_2") ? BulkRunsRows() : MissingRunsShape();

        var rows = await sut.GetBulkRunListAsync(new BulkRunListRequest { RunDate = new DateTime(2099, 1, 5) });

        Assert.Equal(2, rows.Count);
        Assert.All(rows, r => Assert.Equal(41, r.Id));
        Assert.Equal(7, rows.Single(r => r.CourierCode == "C7").CourierId);
        Assert.Null(rows.Single(r => r.CourierCode == null).CourierId);
    }

    private static DataTable BulkRunsRows()
    {
        var t = new DataTable();
        t.Columns.Add("velocity", typeof(string));
        t.Columns.Add("Status", typeof(string));
        t.Columns.Add("ID", typeof(string));
        t.Columns.Add("Name", typeof(string));
        t.Columns.Add("Area", typeof(string));
        t.Columns.Add("Mins", typeof(int));
        t.Columns.Add("CourierID", typeof(int));
        t.Columns.Add("CourierName", typeof(string));
        t.Columns.Add("CourierCode", typeof(string));
        t.Columns.Add("Kms", typeof(double));
        t.Columns.Add("PreAssigned", typeof(int));
        t.Columns.Add("CourierOnlineStatus", typeof(string));
        t.Columns.Add("CourierOfflineMins", typeof(string));
        t.Columns.Add("Total", typeof(int));
        t.Columns.Add("Incomplete", typeof(int));
        t.Columns.Add("TotalPickup", typeof(int));
        t.Columns.Add("IncompletePickup", typeof(int));
        t.Columns.Add("Suburbs", typeof(string));
        t.Columns.Add("FromCities", typeof(string));
        t.Columns.Add("ToLocationName", typeof(string));
        t.Columns.Add("AgentID", typeof(int));
        t.Columns.Add("AgentName", typeof(string));
        t.Columns.Add("IsNpAgent", typeof(bool));
        t.Columns.Add("HasReturns", typeof(bool));
        t.Columns.Add("ReturnsTotal", typeof(int));
        // M3: real tblBulkRun rows emit NULL route origin.
        t.Columns.Add("OriginLatitude", typeof(decimal));
        t.Columns.Add("OriginLongitude", typeof(decimal));
        t.Rows.Add("green", "LP", "41", "RUN41", "A", DBNull.Value, 7, "Driver Seven", "C7", DBNull.Value, 0,
            null, null, 2, 1, 0, 0, null, null, null, DBNull.Value, null, false, false, 0, DBNull.Value, DBNull.Value);
        t.Rows.Add("green", "READY", "41", "RUN41", "A", DBNull.Value, DBNull.Value, null, null, DBNull.Value, 0,
            null, null, 1, 1, 0, 0, null, null, null, DBNull.Value, null, false, false, 0, DBNull.Value, DBNull.Value);
        return t;
    }

    private static DataTable MissingRunsShape()
    {
        var t = new DataTable();
        foreach (var (n, ty) in new (string, Type)[]
        {
            ("ID", typeof(string)), ("Name", typeof(string)), ("Area", typeof(string)),
            ("Velocity", typeof(string)), ("Status", typeof(string)), ("CourierID", typeof(int)),
            ("CourierName", typeof(string)), ("CourierCode", typeof(string)),
            ("CourierPercentageFormatted", typeof(string)), ("Kms", typeof(double)), ("Mins", typeof(int)),
            ("PreAssigned", typeof(int)), ("CourierOnlineStatus", typeof(string)),
            ("CourierOfflineMins", typeof(string)), ("Suburbs", typeof(string)), ("Total", typeof(int)),
            ("Incomplete", typeof(int)), ("HasReturns", typeof(bool)), ("ReturnsTotal", typeof(int)),
        })
            t.Columns.Add(n, ty);
        return t;
    }
}
