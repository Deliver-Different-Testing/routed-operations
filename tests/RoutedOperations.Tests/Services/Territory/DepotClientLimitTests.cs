using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.Territory;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Territory;

/// <summary>
/// Per-client depot limits (spec 3.2 Depots sub-view, milestone M6).
///
/// The storage rule is inherited from ClientManager's PricingService and is
/// the part worth pinning: a row in tblBulkRegion_ClientLimit MEANS the depot
/// is off for that client, so turning it back on deletes the row rather than
/// setting Deactivated to 0. Anything that writes a 0 row, or leaves a second
/// row behind, reads as permanently off through the legacy app as well as this
/// one, and nothing on either screen would show why.
/// </summary>
public class DepotClientLimitTests
{
    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    private static TerritoryService Svc(DbContextOptions<DespatchContext> opts)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(opts));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(opts)));

        var accessor = Substitute.For<IHttpContextAccessor>();
        accessor.HttpContext.Returns(new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new List<Claim>
            {
                new("CountryCode", "NZ"),
                new(ClaimTypes.Email, "kevin@urgent.co.nz"),
            })),
        });
        return new TerritoryService(factory, accessor);
    }

    /// <summary>Three depots, one of them globally inactive, and client 9196.</summary>
    private static DbContextOptions<DespatchContext> Seed()
    {
        var opts = NewOptions();
        using var db = new DynamicDespatchDbContext(opts);
        db.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 8, Name = "Auckland", Active = true },
            new TblBulkRegion { BulkRegionId = 4, Name = "Hamilton", Active = true },
            new TblBulkRegion { BulkRegionId = 3, Name = "Tauranga", Active = false });
        db.TucClients.Add(new TucClient { UcclId = 9196, UcclCode = "CRECA", UcclName = "Credit Card" });
        db.SaveChanges();
        return opts;
    }

    [Fact]
    public async Task Every_depot_is_listed_for_the_client_including_ones_it_cannot_reach()
    {
        // The filtered depot list would hide a depot the client has no group
        // in, which is exactly the one an operator opens this editor to turn
        // back on.
        var opts = Seed();
        var rows = await Svc(opts).GetDepotClientLimitsAsync(9196);

        Assert.Equal(3, rows.Count);
        Assert.All(rows, r => Assert.False(r.OffForClient));
        // The globally inactive depot is listed, flagged by Active rather than
        // by the per-client switch; the two are different reasons to be off.
        Assert.False(rows.Single(r => r.Id == 3).Active);
    }

    [Fact]
    public async Task Switching_a_depot_off_writes_one_row_marked_deactivated()
    {
        var opts = Seed();
        var result = await Svc(opts).SetDepotClientLimitAsync(4, 9196, off: true);
        Assert.True(result.OffForClient);

        await using var db = new DynamicDespatchDbContext(opts);
        var row = await db.TblBulkRegionClientLimits.SingleAsync();
        Assert.Equal(4, row.BulkRegionId);
        Assert.Equal(9196, row.ClientId);
        Assert.True(row.Deactivated);
    }

    [Fact]
    public async Task Switching_it_back_on_deletes_the_row_rather_than_clearing_the_flag()
    {
        // A row left behind with Deactivated = 0 still reads as "off" to
        // ClientManager, which selects BulkRegionId without looking at the
        // column.
        var opts = Seed();
        var svc = Svc(opts);
        await svc.SetDepotClientLimitAsync(4, 9196, off: true);
        var result = await svc.SetDepotClientLimitAsync(4, 9196, off: false);
        Assert.False(result.OffForClient);

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(0, await db.TblBulkRegionClientLimits.CountAsync());
    }

    [Fact]
    public async Task Switching_off_twice_does_not_write_a_second_row()
    {
        // Two rows would survive one delete, so the depot would come back on
        // only on the second attempt and the operator would see the tick
        // refuse to stick.
        var opts = Seed();
        var svc = Svc(opts);
        await svc.SetDepotClientLimitAsync(4, 9196, off: true);
        await svc.SetDepotClientLimitAsync(4, 9196, off: true);

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(1, await db.TblBulkRegionClientLimits.CountAsync());
    }

    [Fact]
    public async Task A_duplicate_row_written_elsewhere_is_cleared_in_one_go()
    {
        // Nothing stops the legacy app or a hand-written row creating a pair.
        // Turning the depot on has to clear both or it stays off.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.TblBulkRegionClientLimits.AddRange(
                new TblBulkRegionClientLimit { Id = 1, BulkRegionId = 4, ClientId = 9196, Deactivated = true },
                new TblBulkRegionClientLimit { Id = 2, BulkRegionId = 4, ClientId = 9196, Deactivated = true });
            await pre.SaveChangesAsync();
        }

        await Svc(opts).SetDepotClientLimitAsync(4, 9196, off: false);

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(0, await db.TblBulkRegionClientLimits.CountAsync());
    }

    [Fact]
    public async Task One_clients_limit_does_not_touch_another_clients()
    {
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.TucClients.Add(new TucClient { UcclId = 9673, UcclCode = "ASURE", UcclName = "Asure Quality" });
            await pre.SaveChangesAsync();
        }
        var svc = Svc(opts);
        await svc.SetDepotClientLimitAsync(4, 9196, off: true);
        await svc.SetDepotClientLimitAsync(4, 9673, off: true);
        await svc.SetDepotClientLimitAsync(4, 9196, off: false);

        var other = await svc.GetDepotClientLimitsAsync(9673);
        Assert.True(other.Single(r => r.Id == 4).OffForClient);

        var mine = await svc.GetDepotClientLimitsAsync(9196);
        Assert.False(mine.Single(r => r.Id == 4).OffForClient);
    }

    [Fact]
    public async Task An_unknown_client_is_refused_rather_than_writing_a_row_nothing_reads()
    {
        var opts = Seed();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Svc(opts).SetDepotClientLimitAsync(4, 999999, off: true));
        Assert.Contains("999999", ex.Message);

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(0, await db.TblBulkRegionClientLimits.CountAsync());
    }

    [Fact]
    public async Task An_unknown_depot_is_refused()
    {
        var opts = Seed();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Svc(opts).SetDepotClientLimitAsync(999, 9196, off: true));
        Assert.Contains("999", ex.Message);
    }
}
