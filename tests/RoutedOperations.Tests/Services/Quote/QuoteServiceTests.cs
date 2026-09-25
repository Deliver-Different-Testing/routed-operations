using RoutedOperations.Core.Application.Dtos.Quote;
using RoutedOperations.Core.Application.Services.Quote;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Quote;

public class QuoteServiceTests
{
    private static QuoteService NewSvc(out Core.Domain.DynamicDespatchDbContext seed, out Microsoft.EntityFrameworkCore.DbContextOptions<Core.Domain.DespatchContext> opts)
    {
        opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        return new QuoteService(CockpitTestHarness.Factory(opts));
    }

    private static QuoteService NewSvc(out Core.Domain.DynamicDespatchDbContext seed) =>
        NewSvc(out seed, out _);

    [Fact]
    public async Task GetSetsAsync_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var sets = await svc.GetSetsAsync();

        Assert.Empty(sets);
    }

    [Fact]
    public async Task GetSetsAsync_GroupsByCodeAndSortsByLastUploadedDesc()
    {
        var svc = NewSvc(out var seed);
        var earlier = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var later = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc);
        seed.TblQuoteJobs.AddRange(
            new TblQuoteJob { QuoteJobId = 1, QuoteSetCode = "A", CreatedUtc = earlier },
            new TblQuoteJob { QuoteJobId = 2, QuoteSetCode = "A", CreatedUtc = later },
            new TblQuoteJob { QuoteJobId = 3, QuoteSetCode = "B", CreatedUtc = earlier });
        await seed.SaveChangesAsync();

        var sets = await svc.GetSetsAsync();

        Assert.Equal(2, sets.Count);
        Assert.Equal("A", sets[0].QuoteSetCode);
        Assert.Equal(2, sets[0].JobCount);
        Assert.Equal(later, sets[0].LastUploadedUtc);
        Assert.Equal("B", sets[1].QuoteSetCode);
    }

    [Fact]
    public async Task UploadAsync_InsertsAllRowsAndReturnsCount()
    {
        var svc = NewSvc(out _, out var opts);
        var req = new QuoteUploadRequest("SetX", new List<QuoteJobUploadRow>
        {
            new("cust1", "from1", "to1", 1000, 2000, 5m, new TimeOnly(9, 0), new TimeOnly(11, 0), true),
            new("cust2", "from2", "to2", 1001, 2001, 6m, null, null, false),
        });

        var result = await svc.UploadAsync(req);

        Assert.Equal("SetX", result.QuoteSetCode);
        Assert.Equal(2, result.RowsUploaded);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Equal(2, verify.TblQuoteJobs.Count());
    }

    [Fact]
    public async Task DeleteSetAsync_DeletesMatchingRowsReturnsCount()
    {
        var svc = NewSvc(out var seed, out var opts);
        seed.TblQuoteJobs.AddRange(
            new TblQuoteJob { QuoteJobId = 1, QuoteSetCode = "A" },
            new TblQuoteJob { QuoteJobId = 2, QuoteSetCode = "A" },
            new TblQuoteJob { QuoteJobId = 3, QuoteSetCode = "B" });
        await seed.SaveChangesAsync();

        var deleted = await svc.DeleteSetAsync("A");

        Assert.Equal(2, deleted);
        using var verify = CockpitTestHarness.Context(opts);
        Assert.Equal(1, verify.TblQuoteJobs.Count());
    }

    [Fact]
    public async Task DeleteSetAsync_NoMatchReturnsZero()
    {
        var svc = NewSvc(out _);

        var deleted = await svc.DeleteSetAsync("missing");

        Assert.Equal(0, deleted);
    }

    [Fact]
    public async Task SimulateAsync_NoJobsReturnsZeroDrivers()
    {
        var svc = NewSvc(out _);
        var req = new QuoteSimulateRequest("Empty", "standard", "standard", 20, 80);

        var r = await svc.SimulateAsync(req);

        Assert.Equal(0, r.JobCount);
        Assert.Equal(0, r.DriversRequired);
    }

    [Fact]
    public async Task SimulateAsync_DriversUsesCeilingOfJobsOverMaxStops()
    {
        var svc = NewSvc(out var seed);
        for (int i = 1; i <= 25; i++)
            seed.TblQuoteJobs.Add(new TblQuoteJob { QuoteJobId = i, QuoteSetCode = "S" });
        await seed.SaveChangesAsync();
        var req = new QuoteSimulateRequest("S", "standard", "standard", 10, 80);

        var r = await svc.SimulateAsync(req);

        Assert.Equal(25, r.JobCount);
        Assert.Equal(3, r.DriversRequired); // ceil(25/10) = 3
    }

    [Fact]
    public async Task SimulateAsync_ZeroMaxStopsClampedTo1()
    {
        var svc = NewSvc(out var seed);
        seed.TblQuoteJobs.Add(new TblQuoteJob { QuoteJobId = 1, QuoteSetCode = "S" });
        await seed.SaveChangesAsync();
        var req = new QuoteSimulateRequest("S", "standard", "standard", 0, 80);

        var r = await svc.SimulateAsync(req);

        Assert.Equal(1, r.DriversRequired);
    }

    [Fact]
    public async Task SimulateAsync_PremiumRateCardUsesPremiumPricing()
    {
        var svc = NewSvc(out var seed);
        seed.TblQuoteJobs.Add(new TblQuoteJob { QuoteJobId = 1, QuoteSetCode = "S" });
        await seed.SaveChangesAsync();
        var req = new QuoteSimulateRequest("S", "premium", "standard", 10, 80);

        var r = await svc.SimulateAsync(req);

        Assert.Equal(18.50m, r.CostPerJob);
        Assert.Equal(28m, r.MarginPct);
    }

    [Fact]
    public async Task SimulateAsync_BudgetRateCardUsesBudgetPricing()
    {
        var svc = NewSvc(out var seed);
        seed.TblQuoteJobs.Add(new TblQuoteJob { QuoteJobId = 1, QuoteSetCode = "S" });
        await seed.SaveChangesAsync();
        var req = new QuoteSimulateRequest("S", "budget", "standard", 10, 80);

        var r = await svc.SimulateAsync(req);

        Assert.Equal(9.75m, r.CostPerJob);
        Assert.Equal(17m, r.MarginPct);
    }

    [Fact]
    public async Task SimulateAsync_UnknownRateCardFallsBackToStandard()
    {
        var svc = NewSvc(out var seed);
        seed.TblQuoteJobs.Add(new TblQuoteJob { QuoteJobId = 1, QuoteSetCode = "S" });
        await seed.SaveChangesAsync();
        var req = new QuoteSimulateRequest("S", "unknown-tier", "standard", 10, 80);

        var r = await svc.SimulateAsync(req);

        Assert.Equal(12.50m, r.CostPerJob);
        Assert.Equal(22m, r.MarginPct);
    }

    [Fact]
    public async Task SimulateAsync_SameDayServiceMultipliesCostByOnePointTwoFive()
    {
        var svc = NewSvc(out var seed);
        seed.TblQuoteJobs.Add(new TblQuoteJob { QuoteJobId = 1, QuoteSetCode = "S" });
        await seed.SaveChangesAsync();
        var req = new QuoteSimulateRequest("S", "standard", "same-day", 10, 80);

        var r = await svc.SimulateAsync(req);

        Assert.Equal(12.50m * 1.25m, r.CostPerJob);
    }

    [Fact]
    public async Task SimulateAsync_ExpressServiceMultipliesCostByOnePointOneFive()
    {
        var svc = NewSvc(out var seed);
        seed.TblQuoteJobs.Add(new TblQuoteJob { QuoteJobId = 1, QuoteSetCode = "S" });
        await seed.SaveChangesAsync();
        var req = new QuoteSimulateRequest("S", "standard", "express", 10, 80);

        var r = await svc.SimulateAsync(req);

        Assert.Equal(12.50m * 1.15m, r.CostPerJob);
    }

    [Fact]
    public async Task SimulateAsync_RecommendedQuoteEqualsTotalTimesOnePlusMargin()
    {
        var svc = NewSvc(out var seed);
        for (int i = 1; i <= 5; i++)
            seed.TblQuoteJobs.Add(new TblQuoteJob { QuoteJobId = i, QuoteSetCode = "S" });
        await seed.SaveChangesAsync();
        var req = new QuoteSimulateRequest("S", "standard", "standard", 10, 80);

        var r = await svc.SimulateAsync(req);

        var expectedTotal = ((decimal)5 * 12.50m + (decimal)5 * 3.8m * 1.20m) * 1.0m;
        Assert.Equal(Math.Round(expectedTotal, 2), r.TotalCost);
        Assert.Equal(Math.Round(expectedTotal * 1.22m, 2), r.RecommendedQuote);
        Assert.Equal(8.5, r.AvgShiftHours);
    }
}
