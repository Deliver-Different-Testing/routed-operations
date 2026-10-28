using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.RecurringRoute;
using RoutedOperations.Core.Application.Services.RecurringRoute;
using RouteEntity = RoutedOperations.Core.Domain.Despatch.Route;

namespace RoutedOperations.Tests.Services.RecurringRoute;

/// <summary>
/// Feature 5.1 direction + origin handling on RecurringRouteService.
///
/// These earn their keep because the rules encode WHY, not just WHAT:
///   * the validation mirrors CK_Routes_Direction, so if the two drift the
///     operator stops getting a sentence and starts getting Msg 547
///   * ApplyDirection CLEARS the origin when a route goes back to first mile,
///     which is the guard against a later flip to final mile silently
///     inheriting an address nobody remembers setting
///   * CopyAsync validated nothing at all before this, so a copy could
///     persist a shape Create and Update both reject
/// A test that stayed green if any of those flipped would be decorative.
/// </summary>
public class RecurringRouteDirectionTests
{
    private static RecurringRouteService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new List<Claim>())),
        });
        return new RecurringRouteService(CockpitTestHarness.Factory(opts), accessor);
    }

    private static UpsertRouteRequest Req(
        byte direction = RouteDirections.FirstMile,
        int? depotId = null,
        RouteOriginDto? origin = null) =>
        new("Route A", "Area A", null, null, new List<int>(), true, new List<int>(),
            null, direction, depotId, origin);

    private static RouteOriginDto Origin(
        decimal? lat = 42.3876m, decimal? lng = -71.0995m, int? radiusM = 5000) =>
        new("Somerville hub", "1 Test St", "02143", lat, lng, radiusM);

    // ─── validation ────────────────────────────────────────────────────────

    [Fact]
    public async Task FinalMile_WithNoOriginAtAll_IsRejected()
    {
        var svc = NewSvc(out _);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.CreateAsync(Req(RouteDirections.FinalMile)));

        // The message has to name the two ways out, because the operator's
        // next action is choosing one of them.
        Assert.Contains("depot", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("origin address", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task FinalMile_WithDepotOnly_IsAccepted()
    {
        var svc = NewSvc(out _);

        var dto = await svc.CreateAsync(Req(RouteDirections.FinalMile, depotId: 38));

        Assert.Equal(RouteDirections.FinalMile, dto.Direction);
        Assert.Equal(38, dto.DepotId);
        Assert.Null(dto.Origin);
    }

    [Fact]
    public async Task FinalMile_WithCoordinatesOnly_IsAccepted()
    {
        var svc = NewSvc(out _);

        var dto = await svc.CreateAsync(Req(RouteDirections.FinalMile, origin: Origin()));

        Assert.Equal(RouteDirections.FinalMile, dto.Direction);
        Assert.Null(dto.DepotId);
        Assert.Equal(42.3876m, dto.Origin!.Latitude);
        Assert.Equal(5000, dto.Origin.RadiusM);
    }

    [Fact]
    public async Task FinalMile_WithHalfACoordinatePair_IsRejectedEvenWhenADepotIsSet()
    {
        var svc = NewSvc(out _);

        // CK_Routes_Direction would ACCEPT this row: the depot alone satisfies
        // it. We reject anyway, because a lone latitude is the mistake an
        // operator actually makes (type it, tab away) and the resolver would
        // then silently never use the address side.
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.CreateAsync(Req(RouteDirections.FinalMile, depotId: 38,
                                      origin: Origin(lng: null))));

        Assert.Contains("latitude and a longitude", ex.Message);
    }

    [Fact]
    public async Task Direction_OutsideTheCheckConstraint_IsRejected()
    {
        var svc = NewSvc(out _);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.CreateAsync(Req(direction: 3, depotId: 38)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task FinalMile_WithNonPositiveRadius_IsRejected(int radius)
    {
        var svc = NewSvc(out _);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.CreateAsync(Req(RouteDirections.FinalMile, origin: Origin(radiusM: radius))));

        Assert.Contains("radius", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task FinalMile_WithNullRadius_IsAccepted_ResolverSuppliesTheDefault()
    {
        var svc = NewSvc(out _);

        var dto = await svc.CreateAsync(Req(RouteDirections.FinalMile, origin: Origin(radiusM: null)));

        // Null is legal on purpose: CK_Routes_Direction does not force a
        // radius and the resolver owns the 5000 m default, in one place.
        Assert.Null(dto.Origin!.RadiusM);
    }

    // ─── the silent-inherit guard ──────────────────────────────────────────

    [Fact]
    public async Task SwitchingBackToFirstMile_ClearsTheOrigin()
    {
        var svc = NewSvc(out _);
        var created = await svc.CreateAsync(Req(RouteDirections.FinalMile, depotId: 38, origin: Origin()));

        var updated = await svc.UpdateAsync(created.RouteId, Req(RouteDirections.FirstMile));

        // If any of this leaked through, a later flip back to final mile would
        // adopt an address the operator never re-confirmed.
        Assert.Equal(RouteDirections.FirstMile, updated!.Direction);
        Assert.Null(updated.DepotId);
        Assert.Null(updated.Origin);
    }

    // ─── copy ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Copy_CarriesDirectionAndOriginFromTheSource()
    {
        var svc = NewSvc(out _);
        var source = await svc.CreateAsync(Req(RouteDirections.FinalMile, origin: Origin()));

        var copy = await svc.CopyAsync(source.RouteId,
            new CopyRouteRequest("Route A copy", null, null, null, CopyZipcodes: true));

        // A copy that quietly became first mile would be a worse surprise
        // than not offering the choice, and the pair must move together or
        // CK_Routes_Direction rejects the row at SaveChanges.
        Assert.Equal(RouteDirections.FinalMile, copy!.Direction);
        Assert.Equal(42.3876m, copy.Origin!.Latitude);
    }

    [Fact]
    public async Task Copy_RejectsASourceThatIsNotAValidShape()
    {
        var svc = NewSvc(out var seed);
        // Seeded straight through EF so it bypasses the service, which is how
        // such a row would really arise: Configurator shares this table and
        // knows nothing about these columns.
        seed.Routes.Add(new RouteEntity
        {
            RouteId = 900, Name = "Broken", Area = "", Active = true,
            CreatedAt = DateTime.UtcNow, CreatedBy = "seed",
            Direction = RouteDirections.FinalMile,   // final mile with no origin
        });
        await seed.SaveChangesAsync();

        // Before Feature 5.1, CopyAsync called no validation at all.
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.CopyAsync(900, new CopyRouteRequest("copy", null, null, null, false)));
    }

    // ─── projection ────────────────────────────────────────────────────────

    [Fact]
    public async Task FirstMileRoute_ProjectsNullOrigin_NotAnEmptyObject()
    {
        var svc = NewSvc(out _);
        await svc.CreateAsync(Req());

        var rows = await svc.GetAllAsync();

        // The frontend treats "has an address origin" as one null check.
        var row = Assert.Single(rows);
        Assert.Equal(RouteDirections.FirstMile, row.Direction);
        Assert.Null(row.Origin);
        Assert.Equal(string.Empty, row.DepotName);
    }
}
