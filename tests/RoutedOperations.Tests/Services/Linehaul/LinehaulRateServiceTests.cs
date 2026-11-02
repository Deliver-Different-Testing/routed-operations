using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.Linehaul;
using RoutedOperations.Core.Application.Services.Linehaul;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Linehaul;

/// <summary>
/// Linehaul run prices (spec 12.2, milestone M9).
///
/// The thing worth testing here is resolution order, because getting it wrong
/// does not fail: it quietly charges the wrong amount. A price resolves most
/// specific first (the schedule's own, then the run's for that speed, then its
/// any-speed) and a client row beats the default at every level. The seeded
/// data on Urgent is 1,401 rows, every one keyed to a schedule, so the
/// schedule level is the one that actually carries production money.
/// </summary>
public class LinehaulRateServiceTests
{
    private static DbContextOptions<DespatchContext> NewOptions() =>
        new DbContextOptionsBuilder<DespatchContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), b => b.EnableNullChecks(false))
            .Options;

    private static LinehaulRateService Svc(DbContextOptions<DespatchContext> opts)
    {
        var factory = Substitute.For<IDbContextFactory<DynamicDespatchDbContext>>();
        factory.CreateDbContext().Returns(_ => new DynamicDespatchDbContext(opts));
        factory.CreateDbContextAsync(Arg.Any<CancellationToken>())
            .Returns(_ => Task.FromResult(new DynamicDespatchDbContext(opts)));
        return new LinehaulRateService(factory);
    }

    /// <summary>Two runs out of Auckland, one speed, one client, one schedule.</summary>
    private static DbContextOptions<DespatchContext> Seed()
    {
        var opts = NewOptions();
        using var db = new DynamicDespatchDbContext(opts);
        db.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 8, Name = "Auckland", Active = true },
            new TblBulkRegion { BulkRegionId = 4, Name = "Hamilton", Active = true },
            new TblBulkRegion { BulkRegionId = 3, Name = "Tauranga", Active = true });
        db.TblbulkLinehaulRuns.AddRange(
            new TblbulkLinehaulRun
            {
                Id = 1, RunName = "AKL to HAM 5am", FromDepotId = 8, ToDepotId = 4,
                StartTime = new TimeOnly(5, 0), DespatchTime = new TimeOnly(7, 30),
            },
            new TblbulkLinehaulRun
            {
                Id = 2, RunName = "AKL to TNG 6am", FromDepotId = 8, ToDepotId = 3,
                StartTime = new TimeOnly(6, 0),
            });
        db.TucJobTypes.AddRange(
            new TucJobType { UcjtId = 112, UcjtName = "Regional Home Delivery" },
            new TucJobType { UcjtId = 120, UcjtName = "Overnight" });
        db.TucClients.Add(new TucClient { UcclId = 9196, UcclCode = "CRECA", UcclName = "Credit Card" });
        db.BulkRunScheduleHeaders.Add(new BulkRunScheduleHeader
        { ScheduleId = 694, Name = "BOP Regional Home Delivery 11am", CreatedBy = "seed" });
        db.SaveChanges();
        return opts;
    }

    [Fact]
    public async Task Depot_filters_narrow_to_the_runs_that_actually_go_that_way()
    {
        var opts = Seed();
        var svc = Svc(opts);

        Assert.Equal(2, (await svc.GetRunsAsync(fromDepotId: 8)).Count);
        var toTauranga = Assert.Single(await svc.GetRunsAsync(fromDepotId: 8, toDepotId: 3));
        Assert.Equal("AKL to TNG 6am", toTauranga.RunName);
        Assert.Empty(await svc.GetRunsAsync(fromDepotId: 4, toDepotId: 3));
    }

    [Fact]
    public async Task The_run_row_carries_its_depots_and_times_so_a_run_can_be_identified()
    {
        var opts = Seed();
        var run = (await Svc(opts).GetRunsAsync()).Single(r => r.RunId == 1);
        Assert.Equal("Auckland", run.FromDepotName);
        Assert.Equal("Hamilton", run.ToDepotName);
        Assert.Equal("05:00", run.StartTime);
        Assert.Equal("07:30", run.DespatchTime);
    }

    [Fact]
    public async Task A_client_price_beats_the_default_at_the_same_speed()
    {
        // Both rows exist and both are valid; the client's is the one that
        // applies, and showing the default instead would under or over charge
        // without anything on screen looking wrong.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.BulkLinehaulRates.AddRange(
                new BulkLinehaulRate { Id = 1, LinehaulRunId = 1, Amount = 18.00m, Active = true },
                new BulkLinehaulRate { Id = 2, LinehaulRunId = 1, ClientId = 9196, Amount = 14.50m, Active = true });
            await pre.SaveChangesAsync();
        }

        var asDefault = (await Svc(opts).GetRunsAsync()).Single(r => r.RunId == 1);
        Assert.Equal(18.00m, asDefault.AnySpeed.Amount);

        var asClient = (await Svc(opts).GetRunsAsync(clientId: 9196)).Single(r => r.RunId == 1);
        Assert.Equal(14.50m, asClient.AnySpeed.Amount);
    }

    [Fact]
    public async Task Another_clients_price_is_never_shown()
    {
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.TucClients.Add(new TucClient { UcclId = 9673, UcclCode = "ASURE", UcclName = "Asure" });
            pre.BulkLinehaulRates.Add(
                new BulkLinehaulRate { Id = 1, LinehaulRunId = 1, ClientId = 9673, Amount = 99.00m, Active = true });
            await pre.SaveChangesAsync();
        }

        var run = (await Svc(opts).GetRunsAsync(clientId: 9196)).Single(r => r.RunId == 1);
        Assert.Null(run.AnySpeed.Amount);
    }

    [Fact]
    public async Task Schedule_prices_are_summarised_on_the_row_and_not_folded_into_a_speed_cell()
    {
        // The 15 Oct mock had one price per run and speed. Real data has many
        // per run, one per schedule, so the row reports the count and range
        // and the cell stays the run-level price rather than picking one.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.BulkRunScheduleHeaders.Add(new BulkRunScheduleHeader
            { ScheduleId = 697, Name = "BOP Regional Home Delivery 5am", CreatedBy = "seed" });
            pre.BulkLinehaulRates.AddRange(
                new BulkLinehaulRate { Id = 1, LinehaulRunId = 1, Amount = 18.00m, Active = true },
                new BulkLinehaulRate { Id = 2, LinehaulRunId = 1, ScheduleId = 694, Amount = 37.7044m, Active = true },
                new BulkLinehaulRate { Id = 3, LinehaulRunId = 1, ScheduleId = 697, Amount = 17.0201m, Active = true });
            await pre.SaveChangesAsync();
        }

        var run = (await Svc(opts).GetRunsAsync()).Single(r => r.RunId == 1);
        Assert.Equal(18.00m, run.AnySpeed.Amount);
        Assert.Equal(2, run.ScheduleRateCount);
        Assert.Equal(17.0201m, run.ScheduleMinAmount);
        Assert.Equal(37.7044m, run.ScheduleMaxAmount);
        Assert.Equal(
            new[] { "BOP Regional Home Delivery 11am", "BOP Regional Home Delivery 5am" },
            run.UsedBySchedules.ToArray());

        var rows = await Svc(opts).GetScheduleRatesAsync(1);
        Assert.Equal(2, rows.Count);
        Assert.All(rows, x => Assert.Equal("Any speed", x.SpeedName));
    }

    [Fact]
    public async Task Upserting_a_price_that_has_no_row_yet_creates_one()
    {
        var opts = Seed();
        var cell = await Svc(opts).UpsertAsync(new LinehaulRateUpsertRequest
        { LinehaulRunId = 1, SpeedId = 112, Amount = 21.50m });

        Assert.Equal(21.50m, cell.Amount);

        await using var db = new DynamicDespatchDbContext(opts);
        var row = await db.BulkLinehaulRates.SingleAsync();
        Assert.Equal(1, row.LinehaulRunId);
        Assert.Equal(112, row.SpeedId);
        Assert.Null(row.ScheduleId);
        Assert.Null(row.ClientId);
        Assert.True(row.Active);
    }

    [Fact]
    public async Task Clearing_a_price_deactivates_the_row_rather_than_leaving_a_zero()
    {
        // A zero is a real price, and a run that costs nothing is a different
        // statement from a run with no price of its own.
        var opts = Seed();
        var svc = Svc(opts);
        await svc.UpsertAsync(new LinehaulRateUpsertRequest
        { LinehaulRunId = 1, Amount = 18.00m });
        var cleared = await svc.UpsertAsync(new LinehaulRateUpsertRequest
        { LinehaulRunId = 1, Amount = null });

        Assert.Null(cleared.Amount);

        await using var db = new DynamicDespatchDbContext(opts);
        var row = await db.BulkLinehaulRates.SingleAsync();
        Assert.False(row.Active);
        var run = (await Svc(opts).GetRunsAsync()).Single(r => r.RunId == 1);
        Assert.Null(run.AnySpeed.Amount);
    }

    [Fact]
    public async Task A_dollar_amount_and_a_percentage_together_are_refused()
    {
        // The table's CK_BulkLinehaulRate_OneOf would reject it anyway, but as
        // a 500 with no wording the operator can act on.
        var opts = Seed();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Svc(opts).UpsertAsync(new LinehaulRateUpsertRequest
            { LinehaulRunId = 1, Amount = 18m, AmountPercentage = 10m }));
        Assert.Contains("not both", ex.Message);

        await using var db = new DynamicDespatchDbContext(opts);
        Assert.Equal(0, await db.BulkLinehaulRates.CountAsync());
    }

    [Fact]
    public async Task A_negative_price_is_refused()
    {
        var opts = Seed();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Svc(opts).UpsertAsync(new LinehaulRateUpsertRequest
            { LinehaulRunId = 1, Amount = -5m }));
        Assert.Contains("negative", ex.Message);
    }

    [Fact]
    public async Task An_unknown_run_speed_or_client_is_refused_by_name()
    {
        var opts = Seed();
        var svc = Svc(opts);

        var run = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.UpsertAsync(new LinehaulRateUpsertRequest { LinehaulRunId = 999, Amount = 1m }));
        Assert.Contains("999", run.Message);

        var speed = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.UpsertAsync(new LinehaulRateUpsertRequest
            { LinehaulRunId = 1, SpeedId = 888, Amount = 1m }));
        Assert.Contains("888", speed.Message);

        var client = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.UpsertAsync(new LinehaulRateUpsertRequest
            { LinehaulRunId = 1, ClientId = 777, Amount = 1m }));
        Assert.Contains("777", client.Message);
    }

    [Fact]
    public async Task Adding_a_speed_column_seeds_it_from_the_any_speed_price()
    {
        // Marcus's missing control. Starting the column empty makes the
        // operator retype what is already on the row; starting it at zero
        // would be a real price of nothing.
        var opts = Seed();
        var svc = Svc(opts);
        await svc.UpsertAsync(new LinehaulRateUpsertRequest { LinehaulRunId = 1, Amount = 18.00m });

        var cell = await svc.AddSpeedColumnAsync(1, 112);
        Assert.Equal(18.00m, cell.Amount);

        var run = (await svc.GetRunsAsync()).Single(r => r.RunId == 1);
        var column = Assert.Single(run.SpeedCells);
        Assert.Equal(112, column.SpeedId);
        Assert.Equal("Regional Home Delivery", column.SpeedName);
        Assert.Equal(18.00m, column.Amount);
    }

    [Fact]
    public async Task Adding_a_speed_column_with_no_any_speed_price_starts_empty()
    {
        var opts = Seed();
        var cell = await Svc(opts).AddSpeedColumnAsync(1, 112);
        Assert.Null(cell.Amount);

        await using var db = new DynamicDespatchDbContext(opts);
        // Nothing to seed from means nothing is written, rather than a row
        // claiming the run is free on that speed.
        Assert.Equal(0, await db.BulkLinehaulRates.CountAsync());
    }

    [Fact]
    public async Task A_duplicate_row_is_retired_so_the_grid_and_the_rating_agree()
    {
        // Two active rows for one tuple means the grid shows whichever it read
        // first while the rating function resolves whichever it read first,
        // and the two need not match.
        var opts = Seed();
        await using (var pre = new DynamicDespatchDbContext(opts))
        {
            pre.BulkLinehaulRates.AddRange(
                new BulkLinehaulRate { Id = 1, LinehaulRunId = 1, Amount = 18.00m, Active = true },
                new BulkLinehaulRate { Id = 2, LinehaulRunId = 1, Amount = 25.00m, Active = true });
            await pre.SaveChangesAsync();
        }

        await Svc(opts).UpsertAsync(new LinehaulRateUpsertRequest
        { LinehaulRunId = 1, Amount = 20.00m });

        await using var db = new DynamicDespatchDbContext(opts);
        var active = await db.BulkLinehaulRates.Where(x => x.Active).ToListAsync();
        var row = Assert.Single(active);
        Assert.Equal(20.00m, row.Amount);
    }

    [Fact]
    public async Task The_bootstrap_lists_only_depots_that_carry_a_run()
    {
        // Offering every depot would let an operator pick a pair with nothing
        // behind it and read the empty grid as missing data.
        var opts = Seed();
        var boot = await Svc(opts).GetBootstrapAsync();

        Assert.Equal(new[] { "Auckland" }, boot.FromDepots.Select(d => d.Name).ToArray());
        Assert.Equal(new[] { "Hamilton", "Tauranga" }, boot.ToDepots.Select(d => d.Name).ToArray());
        Assert.Equal(2, boot.Speeds.Count);
    }
}
