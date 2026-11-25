// #320 (Steve ruling, Kevin 23 Nov): a Missing job that is lost closes as
// Undeliverable (10) through dbo.RVW_stpMarkJobLost. The proc only acts on a
// job still Missing (1001) and not done, and says so with SELECT Updated.
// These tests pin the call (proc name, parameter names, order, values) and
// that the service reports the proc's answer rather than assuming success,
// so a job someone already completed is not reported as "marked lost".
using System.Data;
using System.Data.Common;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerMarkLostTests
{
    private const string ExpectedExec =
        "EXEC dbo.RVW_stpMarkJobLost @JobID = @JobID, @PODName = @PODName";

    // No @CompletedTime: the proc stamps the tenant's local time itself. A
    // UTC stamp from here would land 12-13 hours off on an NZ tenant.
    [Fact]
    public async Task MarkLost_CallsTheProcWithJobAndPodNameOnly_SoTheProcStampsTenantLocalTime()
    {
        var (sut, capture, guard) = NewSvc(updatedRows: [1]);

        await sut.MarkLostAsync(42);

        Assert.Equal(ExpectedExec, Collapse(capture.CommandText));
        Assert.Equal(["@JobID", "@PODName"], capture.Parameters.Select(p => p.ParameterName));
        Assert.Equal(42, capture.Parameters[0].Value);
        Assert.Equal(RouteViewerJobActionService.MarkLostPodName, capture.Parameters[1].Value);
        // Same NP / branch guard as every other job action.
        await guard.Received(1).EnsureTucJobInScopeAsync(42);
    }

    [Theory]
    [InlineData(1, true)]   // job was Missing and open: closed as Undeliverable
    [InlineData(0, false)]  // job no longer Missing (completed, already lost): untouched
    public async Task MarkLost_ReturnsWhatTheProcReports(int updated, bool expected)
    {
        var (sut, _, _) = NewSvc(updatedRows: [updated]);
        Assert.Equal(expected, await sut.MarkLostAsync(7));
    }

    [Fact]
    public async Task MarkLost_NoResultRow_IsNotReportedAsUpdated()
    {
        var (sut, _, _) = NewSvc(updatedRows: []);
        Assert.False(await sut.MarkLostAsync(7));
    }

    // The real proc: updating tucJob fires the legacy tucJob triggers, which
    // send their OWN result sets (and "NOT UPDATING ANY FIELDS WE REQUIRE"
    // messages) before the proc's final SELECT ... AS Updated. Reading only
    // the first result set either throws (no Updated column) or reads a
    // trigger row, so a job really closed as lost would be reported as a
    // failure. The answer is the LAST result set that has an Updated column.
    [Theory]
    [InlineData(1, true)]
    [InlineData(0, false)]
    public async Task MarkLost_TriggerResultSetsComeFirst_ReadsUpdatedFromTheLastSet(int updated, bool expected)
    {
        var (sut, _, _) = NewSvc(updatedRows: [updated], triggerSetsFirst: 2);
        Assert.Equal(expected, await sut.MarkLostAsync(7));
    }

    [Fact]
    public async Task MarkLost_OnlyTriggerResultSets_NoUpdatedColumn_IsNotReportedAsUpdated()
    {
        var (sut, _, _) = NewSvc(updatedRows: null, triggerSetsFirst: 1);
        Assert.False(await sut.MarkLostAsync(7));
    }

    private static string Collapse(string sql) =>
        System.Text.RegularExpressions.Regex.Replace(sql, @"\s+", " ").Trim();

    internal static (RouteViewerJobActionService sut, FakeConnection capture, INpScopeGuard guard)
        NewSvc(int[]? updatedRows, int triggerSetsFirst = 0)
    {
        var capture = new FakeConnection(updatedRows, triggerSetsFirst);
        var opts = new DbContextOptionsBuilder<RoutedOperations.Core.Domain.DespatchContext>()
            .UseSqlServer(capture)
            .Options;
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(true, null));
        var guard = Substitute.For<INpScopeGuard>();
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext());
        var sut = new RouteViewerJobActionService(factory, resolver, guard, accessor,
            NullLogger<RouteViewerJobActionService>.Instance);
        return (sut, capture, guard);
    }

    // A connection that never reaches a server. It records the command the
    // service sends and answers with the result sets the proc would send:
    // optional trigger-like sets first, then the proc's one-column Updated
    // set (left out when updatedRows is null). Faking the connection rather
    // than intercepting EF covers both EF-issued and plain ADO commands.
    internal sealed class FakeConnection(int[]? updatedRows, int triggerSetsFirst) : DbConnection
    {
        private ConnectionState _state = ConnectionState.Closed;
        public string CommandText { get; set; } = string.Empty;
        public List<DbParameter> Parameters { get; } = new();

        [System.Diagnostics.CodeAnalysis.AllowNull]
        public override string ConnectionString { get; set; } = "Server=none;Database=none";
        public override string Database => "none";
        public override string DataSource => "none";
        public override string ServerVersion => "16.0";
        public override ConnectionState State => _state;
        public override void Open() => _state = ConnectionState.Open;
        public override void Close() => _state = ConnectionState.Closed;
        public override void ChangeDatabase(string databaseName) { }
        protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel) => throw new NotSupportedException();
        protected override DbCommand CreateDbCommand() => new FakeCommand(this);

        public DbDataReader Answer()
        {
            var set = new DataSet();
            for (var i = 0; i < triggerSetsFirst; i++)
            {
                var trigger = set.Tables.Add("trigger" + i);
                trigger.Columns.Add("ucjbID", typeof(int));
                trigger.Columns.Add("Message", typeof(string));
                trigger.Rows.Add(7, "trigger row");
            }
            if (updatedRows != null)
            {
                var result = set.Tables.Add("result");
                result.Columns.Add("Updated", typeof(int));
                foreach (var u in updatedRows) result.Rows.Add(u);
            }
            return set.CreateDataReader();
        }
    }

    private sealed class FakeCommand(FakeConnection connection) : DbCommand
    {
        private readonly FakeParameters _parameters = new();
        [System.Diagnostics.CodeAnalysis.AllowNull]
        public override string CommandText { get; set; } = string.Empty;
        public override int CommandTimeout { get; set; }
        public override CommandType CommandType { get; set; }
        public override bool DesignTimeVisible { get; set; }
        public override UpdateRowSource UpdatedRowSource { get; set; }
        protected override DbConnection? DbConnection { get; set; } = connection;
        protected override DbParameterCollection DbParameterCollection => _parameters;
        protected override DbTransaction? DbTransaction { get; set; }
        public override void Cancel() { }
        public override void Prepare() { }
        protected override DbParameter CreateDbParameter() => new SqlParameter();

        private void Record()
        {
            connection.CommandText = CommandText;
            connection.Parameters.Clear();
            connection.Parameters.AddRange(_parameters.Items);
        }

        protected override DbDataReader ExecuteDbDataReader(CommandBehavior behavior)
        {
            Record();
            return connection.Answer();
        }

        public override int ExecuteNonQuery() { Record(); return 0; }
        public override object? ExecuteScalar() { Record(); return null; }
    }

    private sealed class FakeParameters : DbParameterCollection
    {
        public List<DbParameter> Items { get; } = new();
        public override int Count => Items.Count;
        public override object SyncRoot => Items;
        public override int Add(object value) { Items.Add((DbParameter)value); return Items.Count - 1; }
        public override void AddRange(Array values) { foreach (var v in values) Add(v!); }
        public override void Clear() => Items.Clear();
        public override bool Contains(object value) => Items.Contains((DbParameter)value);
        public override bool Contains(string value) => IndexOf(value) >= 0;
        public override void CopyTo(Array array, int index) => ((System.Collections.ICollection)Items).CopyTo(array, index);
        public override System.Collections.IEnumerator GetEnumerator() => Items.GetEnumerator();
        public override int IndexOf(object value) => Items.IndexOf((DbParameter)value);
        public override int IndexOf(string parameterName) => Items.FindIndex(p => p.ParameterName == parameterName);
        public override void Insert(int index, object value) => Items.Insert(index, (DbParameter)value);
        public override void Remove(object value) => Items.Remove((DbParameter)value);
        public override void RemoveAt(int index) => Items.RemoveAt(index);
        public override void RemoveAt(string parameterName) => RemoveAt(IndexOf(parameterName));
        protected override DbParameter GetParameter(int index) => Items[index];
        protected override DbParameter GetParameter(string parameterName) => Items[IndexOf(parameterName)];
        protected override void SetParameter(int index, DbParameter value) => Items[index] = value;
        protected override void SetParameter(string parameterName, DbParameter value) => Items[IndexOf(parameterName)] = value;
    }
}
