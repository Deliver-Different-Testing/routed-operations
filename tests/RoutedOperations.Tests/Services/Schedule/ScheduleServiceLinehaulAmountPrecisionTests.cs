using System.Data;
using System.Data.Common;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
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
/// UC #1115 spec 2.4 item 4b. Saving schedule #332 on Urgent prod turned leg
/// Amounts 2.8365 and 11.5094 into 2.84 and 11.51. tblBulkScheduleLinehaul.Amount
/// is money (4 decimals), but the EF model left the column type unnamed, so EF
/// used its decimal(18,2) default and SqlClient sent every leg Amount at scale 2.
/// The save is a remove-and-re-add of every leg, so ANY save of a schedule
/// rounded ALL its legs, edited or not. These tests pin the fix: the model maps
/// money, so the parameter keeps 4 decimals, and the save service passes the
/// value through unchanged.
/// </summary>
public class ScheduleServiceLinehaulAmountPrecisionTests : IDisposable
{
    private readonly List<DbConnection> _connections = new();
    public void Dispose() { foreach (var c in _connections) c.Dispose(); }

    private static DynamicDespatchDbContext SqlServerModelOnly() =>
        // No connection is opened; the SQL Server provider is what picks the
        // parameter type, which is where the rounding happened.
        new(new DbContextOptionsBuilder<DespatchContext>()
            .UseSqlServer("Server=.;Database=none;Trusted_Connection=True;").Options);

    [Fact]
    public void Leg_Amount_is_sent_as_money_so_SqlClient_keeps_4_decimals()
    {
        using var ctx = SqlServerModelOnly();
        var amount = ctx.Model.FindEntityType(typeof(TblBulkScheduleLinehaul))!
            .FindProperty(nameof(TblBulkScheduleLinehaul.Amount))!;
        Assert.Equal("money", amount.GetColumnType());

        using var cmd = new SqlCommand();
        var p = (SqlParameter)amount.GetRelationalTypeMapping()
            .CreateParameter(cmd, "@p0", 2.8365m, nullable: true);
        // Before the fix: SqlDbType.Decimal, Precision 18, Scale 2, which SqlClient
        // rounds to 2.84 on the wire.
        Assert.Equal(SqlDbType.Money, p.SqlDbType);
        Assert.NotEqual((byte)2, p.Scale);
        Assert.Equal(2.8365m, (decimal)p.Value);
    }

    [Fact]
    public void Leg_AmountPercentage_matches_the_decimal_8_2_column()
    {
        // The column itself holds 2 decimals, so the editor's 0.5 = 50% fraction
        // is stored as typed; anything finer is the table's limit, not the app's.
        using var ctx = SqlServerModelOnly();
        var pct = ctx.Model.FindEntityType(typeof(TblBulkScheduleLinehaul))!
            .FindProperty(nameof(TblBulkScheduleLinehaul.AmountPercentage))!;
        Assert.Equal("decimal(8,2)", pct.GetColumnType());
    }

    private ScheduleService NewSvc()
    {
        var (opts, connection) = CockpitTestHarness.NewSqliteOptions();
        _connections.Add(connection);
        var accessor = new HttpContextAccessor();
        var cache = new TenantScopedCache(new MemoryCache(new MemoryCacheOptions()), accessor);
        return new ScheduleService(CockpitTestHarness.Factory(opts), NullLogger<ScheduleService>.Instance,
            cache, Substitute.For<IScheduleConverter>(), accessor);
    }

    private static ScheduleGroupUpsertRequest Request(decimal amount) => new()
    {
        Name = "#332",
        RegionId = 1,
        DayWindows = new List<DayWindowUpsertRequest>
        {
            new() { DayOfWeek = 1, StartTime = "08:00", EndTime = "17:00", CutoffDay = 1, CutoffTime = "15:00" },
        },
        Zones = new List<ScheduleZoneUpsertRequest> { new() { Zone = 1, Active = true } },
        Linehauls = new List<ScheduleLinehaulUpsertRequest>
        {
            new()
            {
                Name = "Leg 1", FromDepotId = 1, ToDepotId = 2, WeekDay = new[] { 1, 1, 1, 1, 1, 0, 0 },
                Amount = amount, AmountPercentage = 0m, ApplyDiscount = true, ApplyAddOnPercentage = true,
            },
        },
    };

    // SQLite does not reproduce SqlClient's scale-2 rounding (the tests above do
    // that). This one guards the service's own mapping: no Math.Round or cast
    // between the request and the saved row, on create and on the update path.
    [Fact]
    public async Task UpsertAsync_keeps_4_decimal_leg_Amount_on_create_and_update()
    {
        var svc = NewSvc();
        var created = await svc.UpsertAsync(Request(2.8365m));
        Assert.Equal(2.8365m, (await svc.GetDetailAsync(created.ScheduleId)).Linehauls.Single().Amount);

        var resave = Request(11.5094m);
        resave.ScheduleId = created.ScheduleId;
        await svc.UpsertAsync(resave);
        Assert.Equal(11.5094m, (await svc.GetDetailAsync(created.ScheduleId)).Linehauls.Single().Amount);
    }

    // Real SQL Server round trip through the EF model, rolled back. Skipped unless
    // RO_SQLSERVER_TEST_CONN points at a local Despatch database (same gate as the
    // other *SqlServer tests).
    [Fact]
    public async Task Leg_Amount_round_trips_4_decimals_on_SQL_Server()
    {
        var conn = Environment.GetEnvironmentVariable("RO_SQLSERVER_TEST_CONN");
        if (string.IsNullOrWhiteSpace(conn))
            Assert.Skip("RO_SQLSERVER_TEST_CONN is not set; this test needs a local SQL Server.");
        var server = new SqlConnectionStringBuilder(conn).DataSource;
        if (!server.StartsWith("localhost", StringComparison.OrdinalIgnoreCase)
            && !server.StartsWith("(local)", StringComparison.OrdinalIgnoreCase)
            && !server.StartsWith(".", StringComparison.Ordinal))
            throw new InvalidOperationException($"Refusing to run against non-local server '{server}'.");

        var ct = TestContext.Current.CancellationToken;
        await using var db = new DynamicDespatchDbContext(
            new DbContextOptionsBuilder<DespatchContext>().UseSqlServer(conn).Options);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var leg = await db.TblBulkScheduleLinehauls.AsNoTracking().OrderBy(l => l.Id).FirstAsync(ct);
        leg.Id = 0;
        leg.Amount = 2.8365m;
        db.TblBulkScheduleLinehauls.Add(leg);
        await db.SaveChangesAsync(ct);

        var stored = await db.Database
            .SqlQueryRaw<decimal>("SELECT Amount AS [Value] FROM dbo.tblBulkScheduleLinehaul WHERE Id = {0}", leg.Id)
            .SingleAsync(ct);
        await tx.RollbackAsync(ct);
        Assert.Equal(2.8365m, stored);
    }
}
