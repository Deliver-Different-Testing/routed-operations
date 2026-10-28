using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using RoutedOperations.Core.Application.Dtos.RecurringRoute;
using RoutedOperations.Core.Application.Services.RecurringRoute;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringRoute;

/// <summary>
/// The final-mile master link on a route (final-mile tote scanning, spec 4.1
/// and 4.7). A "master" here is the booking whose realised job the driver
/// opens to scan totes on at the depot and off at the destination.
///
/// These pin the three rules that are NOT obvious from reading the linehaul
/// version they are modelled on, and each would be a silent data problem if it
/// flipped:
///
///   * A final-mile master is keyed on RouteId with LinehaulRunId left NULL.
///     That NULL is the only thing separating it from a linehaul master, so a
///     query that forgot it would hand a linehaul run's master to a route.
///   * Promoting a booking that is already a LINEHAUL master is refused rather
///     than silently done, because doing it would take that booking off its
///     run and the run would lose the job its driver opens.
///   * A null MasterBookingId means "leave it alone", so an ordinary route
///     save that says nothing about the master cannot demote one by omission.
///     This is the one most likely to be broken by a well-meaning refactor.
/// </summary>
public class RecurringRouteFinalMileMasterTests
{
    // opts comes back so every assertion can read through a FRESH context.
    // Asserting on the seeding context instead returns whatever its own change
    // tracker cached when the row was added, which is the service's write
    // invisible - a green test proving nothing.
    private static RecurringRouteService NewSvc(
        out Core.Domain.DynamicDespatchDbContext seed,
        out DbContextOptions<DespatchContext> opts)
    {
        opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new List<Claim>())),
        });
        return new RecurringRouteService(CockpitTestHarness.Factory(opts), accessor);
    }

    private static UpsertRouteRequest Req(
        int? masterBookingId = null,
        byte? deliveryMode = null,
        string name = "Burbank to Lab") =>
        new(name, "Area", null, null, new List<int>(), true, new List<int>(),
            null, RouteDirections.FinalMile, DepotId: 38, Origin: null,
            MasterBookingId: masterBookingId, FinalMileDeliveryMode: deliveryMode);

    private static TucJobBooking Booking(int id, string number) => new()
    {
        UcbkId = id,
        UcbkJobNumber = number,
        UcbkActive = true,
    };

    [Fact]
    public async Task Promoting_a_booking_keys_it_on_the_route_with_a_null_run()
    {
        var svc = NewSvc(out var seed, out var opts);
        seed.TucJobBookings.Add(Booking(900, "P900"));
        await seed.SaveChangesAsync();

        var route = await svc.CreateAsync(Req(masterBookingId: 900,
                                              deliveryMode: 2));

        using var read = CockpitTestHarness.Context(opts);
        var saved = read.TucJobBookings.Single(b => b.UcbkId == 900);
        Assert.Equal(route.RouteId, saved.RouteId);
        Assert.True(saved.IsLinehaulMaster);
        // The NULL that keeps the two kinds of master apart.
        Assert.Null(saved.LinehaulRunId);
        Assert.Equal((byte)2, saved.FinalMileDeliveryMode);

        Assert.Equal(900, route.MasterBookingId);
        Assert.Equal((byte)2, route.FinalMileDeliveryMode);
    }

    [Fact]
    public async Task Promoting_a_linehaul_master_is_refused_rather_than_stealing_it()
    {
        // The booking already runs a linehaul leg. Taking it would leave that
        // run with no master job for its driver to open, which is a worse
        // outcome than refusing the save.
        var svc = NewSvc(out var seed, out var opts);
        var lh = Booking(901, "P901");
        lh.IsLinehaulMaster = true;
        lh.LinehaulRunId = 14;
        seed.TucJobBookings.Add(lh);
        await seed.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => svc.CreateAsync(Req(masterBookingId: 901)));

        Assert.Contains("linehaul run", ex.Message, StringComparison.OrdinalIgnoreCase);
        // Still on its run, untouched.
        using var read = CockpitTestHarness.Context(opts);
        var still = read.TucJobBookings.Single(b => b.UcbkId == 901);
        Assert.Equal(14, still.LinehaulRunId);
        Assert.True(still.IsLinehaulMaster);
    }

    [Fact]
    public async Task A_save_that_says_nothing_about_the_master_leaves_it_alone()
    {
        // The case a refactor breaks: an operator renames the route, the save
        // omits the master, and the route silently loses it.
        var svc = NewSvc(out var seed, out var opts);
        seed.TucJobBookings.Add(Booking(902, "P902"));
        await seed.SaveChangesAsync();

        var route = await svc.CreateAsync(Req(masterBookingId: 902));
        Assert.Equal(902, route.MasterBookingId);

        var renamed = await svc.UpdateAsync(route.RouteId,
            Req(masterBookingId: null, name: "Burbank to Lab (renamed)"));

        Assert.Equal(902, renamed!.MasterBookingId);
        using var read = CockpitTestHarness.Context(opts);
        Assert.True(read.TucJobBookings.Single(b => b.UcbkId == 902).IsLinehaulMaster);
    }

    [Fact]
    public async Task Zero_clears_the_master_where_null_would_not()
    {
        var svc = NewSvc(out var seed, out var opts);
        seed.TucJobBookings.Add(Booking(903, "P903"));
        await seed.SaveChangesAsync();

        var route = await svc.CreateAsync(Req(masterBookingId: 903));
        var cleared = await svc.UpdateAsync(route.RouteId, Req(masterBookingId: 0));

        Assert.Null(cleared!.MasterBookingId);
        using var read = CockpitTestHarness.Context(opts);
        Assert.False(read.TucJobBookings.Single(b => b.UcbkId == 903).IsLinehaulMaster);
    }

    [Fact]
    public async Task Demoting_unbinds_the_booking_from_the_route()
    {
        // Promoting SETS RouteId, and the editor's booking list is read-only,
        // so a demote that left it behind would be a field the app can set and
        // never unset. That is how the 21 Oct browser test stranded a booking.
        var svc = NewSvc(out var seed, out var opts);
        seed.TucJobBookings.Add(Booking(906, "P906"));
        await seed.SaveChangesAsync();

        var route = await svc.CreateAsync(Req(masterBookingId: 906));
        using (var mid = CockpitTestHarness.Context(opts))
            Assert.Equal(route.RouteId, mid.TucJobBookings.Single(b => b.UcbkId == 906).RouteId);

        await svc.UpdateAsync(route.RouteId, Req(masterBookingId: 0));

        using var read = CockpitTestHarness.Context(opts);
        var after = read.TucJobBookings.Single(b => b.UcbkId == 906);
        Assert.False(after.IsLinehaulMaster);
        Assert.Null(after.RouteId);
    }

    [Fact]
    public async Task Choosing_a_second_master_demotes_the_first()
    {
        // One master per route. The demote-then-promote order matters: doing
        // it the other way round leaves two masters for an instant, and the
        // read side picks the lowest id, which is the one being replaced.
        var svc = NewSvc(out var seed, out var opts);
        seed.TucJobBookings.Add(Booking(904, "P904"));
        seed.TucJobBookings.Add(Booking(905, "P905"));
        await seed.SaveChangesAsync();

        var route = await svc.CreateAsync(Req(masterBookingId: 904));
        var moved = await svc.UpdateAsync(route.RouteId, Req(masterBookingId: 905));

        Assert.Equal(905, moved!.MasterBookingId);
        using var read = CockpitTestHarness.Context(opts);
        var old904 = read.TucJobBookings.Single(b => b.UcbkId == 904);
        Assert.False(old904.IsLinehaulMaster);
        Assert.Null(old904.RouteId);
        Assert.True(read.TucJobBookings.Single(b => b.UcbkId == 905).IsLinehaulMaster);
    }
}
