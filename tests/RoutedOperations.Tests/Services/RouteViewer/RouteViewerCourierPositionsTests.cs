// Cheetah R3 (2026-11-28). The "All couriers" map 500'd on Cheetah every
// 30 s because MAP_stpEnvelope returns columns AvailableCourierPositionDto
// does not have (no CourierCode, no time) and drops every US courier. These
// tests feed a fake result set with the RVW proc's six columns through EF,
// so they fail if the service goes back to the legacy proc, if the column
// names drift from the contract, or if the branch filter is dropped.
using System.Data;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using RoutedOperations.Core.Application.Services.Branches;
using RoutedOperations.Core.Application.Services.Np;
using RoutedOperations.Core.Application.Services.RouteViewer;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Tests.Services.RouteViewer;

public class RouteViewerCourierPositionsTests
{
    private static readonly DateTime Fix = new(2026, 11, 28, 9, 41, 0);

    /// <summary>Answers every query with the given rows (contract column names) and records the SQL.</summary>
    private sealed class FakeResultSet(params object?[][] rows) : DbCommandInterceptor, IDbConnectionInterceptor
    {
        public List<(string Sql, Dictionary<string, object?> Args)> Commands { get; } = new();

        private DbDataReader Reader(DbCommand command)
        {
            Commands.Add((command.CommandText, command.Parameters.Cast<DbParameter>()
                .ToDictionary(p => p.ParameterName, p => p.Value is DBNull ? null : p.Value)));
            var t = new DataTable();
            t.Columns.Add("CourierId", typeof(int));
            t.Columns.Add("CourierCode", typeof(string));
            t.Columns.Add("VehicleType", typeof(string));
            t.Columns.Add("Latitude", typeof(decimal));
            t.Columns.Add("Longitude", typeof(decimal));
            t.Columns.Add("Timestamp", typeof(DateTime));
            foreach (var r in rows) t.Rows.Add(r.Select(v => v ?? DBNull.Value).ToArray());
            return t.CreateDataReader();
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
            => ValueTask.FromResult(InterceptionResult<DbDataReader>.SuppressWithResult(Reader(command)));

        public ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
            => ValueTask.FromResult(InterceptionResult.Suppress());

        public InterceptionResult ConnectionOpening(DbConnection connection,
            ConnectionEventData eventData, InterceptionResult result) => InterceptionResult.Suppress();
    }

    private static RouteViewerCourierService Service(FakeResultSet fake, IBranchScopeGuard? guard = null, bool admin = true)
    {
        var opts = new DbContextOptionsBuilder<DespatchContext>()
            .UseSqlServer("Server=unused;Database=unused;Trusted_Connection=True;")
            .AddInterceptors(fake)
            .Options;
        var resolver = Substitute.For<INpScopeResolver>();
        resolver.ResolveAsync().Returns(new NpScope(admin, null));
        return new RouteViewerCourierService(RouteViewerTestHarness.Factory(opts), resolver,
            guard ?? RoutedOperations.Tests.Branches.BranchTestDoubles.Unrestricted(),
            NullLogger<RouteViewerCourierService>.Instance);
    }

    private static IBranchScopeGuard OnlyCourier(int visibleCourierId)
    {
        var guard = Substitute.For<IBranchScopeGuard>();
        guard.IsRestricted.Returns(true);
        guard.VisibleCourierIdsAsync(Arg.Any<IReadOnlyCollection<int>>())
            .Returns(Task.FromResult<IReadOnlySet<int>>(new HashSet<int> { visibleCourierId }));
        return guard;
    }

    [Fact]
    public async Task Envelope_calls_the_RVW_proc_and_maps_its_six_columns()
    {
        var fake = new FakeResultSet(
            new object?[] { 2, "22", "V", 40.712800000m, -74.006000000m, Fix },
            new object?[] { 17, "17", null, 40.650000000m, -73.950000000m, Fix });

        var rows = await Service(fake).GetAvailableCourierPositionsAsync(-180, -90, 180, 90);

        var sql = Assert.Single(fake.Commands).Sql;
        Assert.Contains("EXEC dbo.RVW_stpCourierPositions_Envelope @MinLng, @MinLat, @MaxLng, @MaxLat", sql);
        Assert.DoesNotContain("MAP_stpEnvelope", sql);
        Assert.Equal(-180m, fake.Commands[0].Args["@MinLng"]);
        Assert.Equal(90m, fake.Commands[0].Args["@MaxLat"]);

        Assert.Equal(2, rows.Count);
        var bruce = rows[0];
        Assert.Equal((2, "22", "V", 40.7128m, -74.006m, (DateTime?)Fix),
            (bruce.CourierId, bruce.CourierCode, bruce.VehicleType, bruce.Latitude!.Value, bruce.Longitude!.Value, bruce.Timestamp));
        Assert.Null(rows[1].VehicleType);
    }

    [Fact]
    public async Task Envelope_still_drops_couriers_outside_the_callers_branches()
    {
        var fake = new FakeResultSet(
            new object?[] { 2, "22", "V", 40.7m, -74.0m, Fix },
            new object?[] { 17, "17", "C", 40.6m, -73.9m, Fix });

        var rows = await Service(fake, OnlyCourier(17)).GetAvailableCourierPositionsAsync(-180, -90, 180, 90);

        Assert.Equal(17, Assert.Single(rows).CourierId);
    }

    [Fact]
    public async Task Last_position_returns_the_run_driver_from_the_RVW_proc()
    {
        var fake = new FakeResultSet(new object?[] { 2, "22", "V", 40.7128m, -74.006m, Fix });

        var pos = await Service(fake).GetCourierLastPositionAsync(2);

        var (sql, args) = Assert.Single(fake.Commands);
        Assert.Contains("EXEC dbo.RVW_stpCourierLastPosition @CourierID", sql);
        Assert.Equal(2, args["@CourierID"]);
        Assert.NotNull(pos);
        Assert.Equal(("22", 40.7128m, -74.006m), (pos!.CourierCode, pos.Latitude!.Value, pos.Longitude!.Value));
    }

    [Fact]
    public async Task Last_position_is_null_with_no_fix_no_courier_outside_branches_or_for_NP()
    {
        Assert.Null(await Service(new FakeResultSet()).GetCourierLastPositionAsync(2));                 // never sent a fix
        var none = new FakeResultSet(new object?[] { 2, "22", "V", 40.7m, -74.0m, Fix });
        Assert.Null(await Service(none).GetCourierLastPositionAsync(0));                                 // run has no driver
        Assert.Empty(none.Commands);
        Assert.Null(await Service(new FakeResultSet(new object?[] { 2, "22", "V", 40.7m, -74.0m, Fix }), OnlyCourier(17))
            .GetCourierLastPositionAsync(2));                                                            // other branch
        Assert.Null(await Service(new FakeResultSet(new object?[] { 2, "22", "V", 40.7m, -74.0m, Fix }), admin: false)
            .GetCourierLastPositionAsync(2));                                                            // NP portal
    }
}
