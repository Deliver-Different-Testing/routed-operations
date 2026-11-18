using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.RecurringRoute;
using RoutedOperations.Core.Application.Services.RecurringRoute;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringRoute;

/// <summary>
/// The parts of POST schedules/coverage-match that run without SQL Server
/// (final-mile route setup spec 4.2). The overlap rule itself lives in the
/// region TVFs and is exercised by the scratch harness on local NZ + US.
///
/// Why these matter:
///   * routePostcodeCount is the "M" in "N of M postcodes". If 0602 and 602
///     counted twice, every NZ route with a leading-zero zip would read as
///     only partly covered by a schedule that covers all of it.
///   * a header with no live day row, or no overlap, must never reach the
///     editor: it cannot be ticked from the lookup, so showing it would offer
///     a schedule the operator cannot pick.
///   * an empty route and a first-mile route must not touch SQL at all. The
///     InMemory provider throws on the Dapper call, so these stay red if the
///     short-circuit is ever removed.
/// </summary>
public class ScheduleCoverageMatchTests
{
    private static RecurringRouteService NewSvc(out Core.Domain.DynamicDespatchDbContext seed, string? country = null)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var claims = new List<Claim>();
        if (country is not null) claims.Add(new Claim("CountryCode", country));
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims)),
        });
        return new RecurringRouteService(CockpitTestHarness.Factory(opts), accessor);
    }

    // ─── NormaliseRoutePostcodes ───────────────────────────────────────────

    [Fact]
    public void Nz_LeadingZeroAndPlainForm_AreOnePostcode()
    {
        var result = RecurringRouteService.NormaliseRoutePostcodes(
            new[] { "0602", "602", " 0602 ", "3700" }, isUs: false);

        Assert.Equal(new[] { "602", "3700" }, result);
    }

    [Fact]
    public void BlanksAndNulls_AreDropped()
    {
        var result = RecurringRouteService.NormaliseRoutePostcodes(
            new string?[] { null, "", "   ", "600" }, isUs: false);

        Assert.Equal(new[] { "600" }, result);
    }

    [Fact]
    public void Us_ShortZip_IsPaddedToFive_SoItMatchesThePaddedForm()
    {
        var result = RecurringRouteService.NormaliseRoutePostcodes(
            new[] { "2143", "02143", "91505", "K1A 0B1" }, isUs: true);

        Assert.Equal(new[] { "02143", "91505", "K1A 0B1" }, result);
    }

    [Fact]
    public void Us_LeadingZero_IsKept()
    {
        // The NZ rule (strip zeros) applied to a US ZIP would turn 02143 into
        // 2143, which the US TVF does not match as text.
        var result = RecurringRouteService.NormaliseRoutePostcodes(new[] { "02143" }, isUs: true);

        Assert.Equal(new[] { "02143" }, result);
    }

    // ─── ToCoverageMatchRows ───────────────────────────────────────────────

    [Fact]
    public void Rows_WithNoOverlapOrNoLiveDayRow_AreDropped_AndTheRestSortLargestFirst()
    {
        var sql = new[]
        {
            new RecurringRouteService.CoverageMatchSqlRow { HeaderId = 7, ScheduleId = 70, MatchedCount = 2 },
            new RecurringRouteService.CoverageMatchSqlRow { HeaderId = 3, ScheduleId = 30, MatchedCount = 0 },
            new RecurringRouteService.CoverageMatchSqlRow { HeaderId = 4, ScheduleId = null, MatchedCount = 9 },
            new RecurringRouteService.CoverageMatchSqlRow { HeaderId = 5, ScheduleId = 50, MatchedCount = 6, DepotWide = true },
            new RecurringRouteService.CoverageMatchSqlRow { HeaderId = 2, ScheduleId = 20, MatchedCount = 2 },
        };

        var rows = RecurringRouteService.ToCoverageMatchRows(sql);

        Assert.Equal(new[]
        {
            new CoverageMatchRowDto(50, 5, 6, true),
            new CoverageMatchRowDto(20, 2, 2, false),
            new CoverageMatchRowDto(70, 7, 2, false),
        }, rows);
    }

    [Fact]
    public void Sql_UsesTheRegionFunction()
    {
        Assert.Contains("dbo.UTL_fncScheduleDeliveryCoverage(@PostcodesJson)", RecurringRouteService_Sql(false));
        Assert.Contains("dbo.DD_fncScheduleDeliveryCoverage(@PostcodesJson)", RecurringRouteService_Sql(true));
        Assert.Contains("RetiredUtc IS NULL", RecurringRouteService_Sql(false));
    }

    private static string RecurringRouteService_Sql(bool isUs) =>
        typeof(RecurringRouteService)
            .GetMethod("CoverageMatchSql", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!
            .Invoke(null, new object[] { isUs }) as string ?? "";

    // ─── MatchScheduleCoverageAsync short-circuits ─────────────────────────

    [Fact]
    public async Task EmptyCoverage_ReturnsZeroAndNoRows_WithoutSql()
    {
        var svc = NewSvc(out _);

        var res = await svc.MatchScheduleCoverageAsync(
            new CoverageMatchRequest(RouteDirections.FinalMile, new List<int>(), new List<int>()));

        Assert.Equal(0, res.RoutePostcodeCount);
        Assert.Empty(res.Rows);
    }

    [Fact]
    public async Task FirstMile_CountsTheRoutePostcodes_ButReturnsNoRows()
    {
        var svc = NewSvc(out var seed);
        seed.ZipPolygons.AddRange(
            new ZipPolygon { ZipPolygonId = 1, Zip = "0602", Wkt = "" },
            new ZipPolygon { ZipPolygonId = 2, Zip = "3700", Wkt = "" });
        seed.BulkRunPolygons.AddRange(
            new BulkRunPolygon { PolygonId = 10, Name = "Live", ColorHex = "#000", TagLocation = "", Active = true },
            new BulkRunPolygon { PolygonId = 11, Name = "Retired", ColorHex = "#000", TagLocation = "", Active = false });
        seed.BulkRunPolygonZips.AddRange(
            new BulkRunPolygonZip { PolygonId = 10, Zip = "602", OverlapPct = 4m },   // sliver still counts, dedupes with 0602
            new BulkRunPolygonZip { PolygonId = 10, Zip = "3701", OverlapPct = 100m, IsFull = true },
            new BulkRunPolygonZip { PolygonId = 11, Zip = "9999", OverlapPct = 100m }); // inactive polygon covers nothing
        await seed.SaveChangesAsync();

        var res = await svc.MatchScheduleCoverageAsync(
            new CoverageMatchRequest(RouteDirections.FirstMile, new List<int> { 1, 2 }, new List<int> { 10, 11 }));

        Assert.Equal(3, res.RoutePostcodeCount); // 602, 3700, 3701
        Assert.Empty(res.Rows);
    }

    [Fact]
    public async Task CoverageThatResolvesToNoPostcodes_ReturnsZero_WithoutSql()
    {
        var svc = NewSvc(out var seed);
        seed.BulkRunPolygons.Add(
            new BulkRunPolygon { PolygonId = 11, Name = "Retired", ColorHex = "#000", TagLocation = "", Active = false });
        seed.BulkRunPolygonZips.Add(new BulkRunPolygonZip { PolygonId = 11, Zip = "9999", OverlapPct = 100m });
        await seed.SaveChangesAsync();

        var res = await svc.MatchScheduleCoverageAsync(
            new CoverageMatchRequest(RouteDirections.FinalMile, new List<int>(), new List<int> { 11 }));

        Assert.Equal(0, res.RoutePostcodeCount);
        Assert.Empty(res.Rows);
    }
}
