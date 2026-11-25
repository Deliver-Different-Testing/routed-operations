// #880 (contract 3): Print Manager's "Include on-demand" toggle reaches
// RVW_stpPrintJobsV2 as @IncludeOnDemand, a bit and the LAST parameter. With
// the toggle off the call is today's call exactly (five parameters, same
// EXEC text), so an app deployed ahead of the migration still works and the
// default output is unchanged byte for byte.
using Amazon.S3;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Data.SqlClient;
using RoutedOperations.Core.Application.Dtos.RouteViewer;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerPrintJobsOnDemandTests
{
    private const string TodayExec =
        "EXEC dbo.RVW_stpPrintJobsV2 @ClientID = @ClientID, @RunDate = @RunDate, @Regions = @Regions, @ClientIDs = @ClientIDs, @NpAgentId = @NpAgentId";

    [Fact]
    public async Task IncludeOnDemand_True_SendsBitAsLastParameter()
    {
        var (sut, capture) = NewCapturingSvc(new NpScope(true, null));
        await Assert.ThrowsAsync<CapturedSqlException>(() => sut.GetPrintJobListAsync(
            new BulkRunListRequest { RunDate = new DateTime(2026, 11, 20), IncludeOnDemand = true }));

        Assert.Contains("@IncludeOnDemand = @IncludeOnDemand", capture.CommandText);
        var last = Assert.IsType<SqlParameter>(capture.Parameters[^1]);
        Assert.Equal("@IncludeOnDemand", last.ParameterName);
        Assert.Equal(System.Data.SqlDbType.Bit, last.SqlDbType);
        Assert.Equal(true, last.Value);
        // The SP's existing five parameters keep their order ahead of it.
        Assert.Equal(
            ["@ClientID", "@RunDate", "@Regions", "@ClientIDs", "@NpAgentId", "@IncludeOnDemand"],
            capture.Parameters.Select(p => p.ParameterName));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(null)]
    public async Task IncludeOnDemand_OffOrAbsent_IsTodaysCallExactly(bool? include)
    {
        var (sut, capture) = NewCapturingSvc(new NpScope(true, null));
        await Assert.ThrowsAsync<CapturedSqlException>(() => sut.GetPrintJobListAsync(
            new BulkRunListRequest { RunDate = new DateTime(2026, 11, 20), IncludeOnDemand = include }));

        Assert.Equal(TodayExec, Collapse(capture.CommandText));
        Assert.Equal(
            ["@ClientID", "@RunDate", "@Regions", "@ClientIDs", "@NpAgentId"],
            capture.Parameters.Select(p => p.ParameterName));
    }

    private static string Collapse(string sql) =>
        System.Text.RegularExpressions.Regex.Replace(sql, @"\s+", " ").Trim();

    private static (RouteViewerJobService sut, CaptureSqlInterceptor capture) NewCapturingSvc(NpScope scope)
    {
        var capture = new CaptureSqlInterceptor();
        var opts = new DbContextOptionsBuilder<RoutedOperations.Core.Domain.DespatchContext>()
            .UseSqlServer("Server=none;Database=none")
            .AddInterceptors(capture)
            .Options;
        var factory = RouteViewerTestHarness.Factory(opts);
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(scope);
        var reader = new S3PhotoReader(Substitute.For<IAmazonS3>(), NullLogger<S3PhotoReader>.Instance);
        var sut = new RouteViewerJobService(factory, resolver, Substitute.For<INpScopeGuard>(),
            RoutedOperations.Tests.Branches.BranchTestDoubles.Unrestricted(), reader,
            NullLogger<RouteViewerJobService>.Instance);
        return (sut, capture);
    }

    private sealed class CapturedSqlException : Exception;

    // Skips the connection open (no server) and records the command EF is
    // about to run, then aborts before anything is sent.
    private sealed class CaptureSqlInterceptor :
        Microsoft.EntityFrameworkCore.Diagnostics.IDbConnectionInterceptor,
        Microsoft.EntityFrameworkCore.Diagnostics.IDbCommandInterceptor
    {
        public string CommandText { get; private set; } = string.Empty;
        public List<System.Data.Common.DbParameter> Parameters { get; } = new();

        public Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult ConnectionOpening(
            System.Data.Common.DbConnection connection,
            Microsoft.EntityFrameworkCore.Diagnostics.ConnectionEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult result)
            => Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult.Suppress();

        public ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult> ConnectionOpeningAsync(
            System.Data.Common.DbConnection connection,
            Microsoft.EntityFrameworkCore.Diagnostics.ConnectionEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult result,
            CancellationToken cancellationToken = default)
            => ValueTask.FromResult(Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult.Suppress());

        public ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
            System.Data.Common.DbCommand command,
            Microsoft.EntityFrameworkCore.Diagnostics.CommandEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<System.Data.Common.DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            CommandText = command.CommandText;
            foreach (System.Data.Common.DbParameter p in command.Parameters) Parameters.Add(p);
            throw new CapturedSqlException();
        }
    }
}
