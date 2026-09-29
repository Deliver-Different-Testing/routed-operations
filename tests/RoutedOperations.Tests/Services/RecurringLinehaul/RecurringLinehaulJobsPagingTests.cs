// Paging for the Mapped Stops drill-down (Bug 3).
//
// Two separate concerns are covered here:
//
//  1. Behaviour - page boundaries, the total, clamping, and above all that the
//     ordering is TOTAL so OFFSET/FETCH cannot repeat or drop a row. These run
//     on the InMemory provider like the rest of the suite.
//
//  2. The SQL shape - that the two sources become one UNION ALL statement with
//     the sort and the paging done by the server - is NOT asserted here. It
//     cannot be: the InMemory provider emits no SQL, and reaching the composed
//     query from a test would need either a public test hook on the service or
//     InternalsVisibleTo, which this repo deliberately avoids (see
//     Integration/TestFactory.cs). It was verified once by hand against the SQL
//     Server provider and the resulting statement is recorded verbatim in
//     RecurringLinehaulJobsService.BuildStops. Re-check it there when touching
//     that chain: inserting a ToList or AsEnumerable moves the paging back into
//     memory and nothing below would fail.
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

public class RecurringLinehaulJobsPagingTests
{
    private static RecurringLinehaulJobsService NewSvc(out DynamicDespatchDbContext seed)
    {
        var opts = RecurringLinehaulTestHarness.NewOptions();
        seed = RecurringLinehaulTestHarness.Context(opts);
        return new RecurringLinehaulJobsService(RecurringLinehaulTestHarness.Factory(opts));
    }

    /// <summary>Seeds n rows for run 42, spread one per day so the order is
    /// unambiguous, alternating across both sources so every page is a mix.</summary>
    private static async Task SeedSpreadAsync(DynamicDespatchDbContext seed, int n)
    {
        var day0 = new DateTime(2026, 1, 1);
        for (var i = 0; i < n; i++)
        {
            var d = day0.AddDays(i);
            if (i % 2 == 0)
            {
                seed.TblBulkJobs.Add(new TblBulkJob
                {
                    BulkJobId = 1000 + i, JobNumber = $"J{i:D3}", LinehaulRunId = 42,
                    BookDate = d, BookTime = d
                });
            }
            else
            {
                seed.TucJobs.Add(new TucJob
                {
                    UcjbId = 2000 + i, UcjbNumber = $"J{i:D3}", LinehaulRunId = 42,
                    UcjbDate = d, UcjbTime = d
                });
            }
        }
        await seed.SaveChangesAsync();
    }

    // ── behaviour ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Defaults_ToFirstPageOfFifty()
    {
        var svc = NewSvc(out var seed);
        await SeedSpreadAsync(seed, 60);

        var res = await svc.ListForLinehaulRunAsync(42);

        Assert.Equal(60, res.Total);
        Assert.Equal(1, res.Page);
        Assert.Equal(50, res.PageSize);
        Assert.Equal(50, res.Entries.Count);
    }

    [Fact]
    public async Task TotalCountsEveryMatchingRowNotJustThePage()
    {
        var svc = NewSvc(out var seed);
        await SeedSpreadAsync(seed, 60);

        var res = await svc.ListForLinehaulRunAsync(42, page: 1, pageSize: 10);

        Assert.Equal(60, res.Total);
        Assert.Equal(10, res.Entries.Count);
    }

    [Fact]
    public async Task LastPageReturnsTheRemainder()
    {
        var svc = NewSvc(out var seed);
        await SeedSpreadAsync(seed, 25);

        var res = await svc.ListForLinehaulRunAsync(42, page: 3, pageSize: 10);

        Assert.Equal(25, res.Total);
        Assert.Equal(5, res.Entries.Count);
    }

    [Fact]
    public async Task PageBeyondTheEndIsEmptyButKeepsTheTotal()
    {
        var svc = NewSvc(out var seed);
        await SeedSpreadAsync(seed, 5);

        var res = await svc.ListForLinehaulRunAsync(42, page: 99, pageSize: 10);

        Assert.Equal(5, res.Total);
        Assert.Empty(res.Entries);
    }

    [Fact]
    public async Task PagesDoNotOverlapAndCoverEveryRowExactlyOnce()
    {
        // The property that matters: walking the pages reconstructs the whole set
        // with no duplicate and nothing missing.
        var svc = NewSvc(out var seed);
        await SeedSpreadAsync(seed, 25);

        var seen = new List<string>();
        for (var p = 1; p <= 3; p++)
        {
            var res = await svc.ListForLinehaulRunAsync(42, page: p, pageSize: 10);
            seen.AddRange(res.Entries.Select(e => $"{e.Source}:{e.Id}"));
        }

        Assert.Equal(25, seen.Count);
        Assert.Equal(25, seen.Distinct().Count());
    }

    [Fact]
    public async Task PagingIsStableWhenEveryRowSharesDateAndTime()
    {
        // The case the (Source, Id) tie-break exists for. With only BookDate and
        // BookTime in the ORDER BY the order is not total, and SQL Server may
        // return a row on two pages and drop another. Every row here is on the
        // same date and time, across both sources.
        var svc = NewSvc(out var seed);
        var same = new DateTime(2026, 5, 1, 9, 0, 0);
        for (var i = 0; i < 9; i++)
        {
            seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 100 + i, JobNumber = $"B{i}", LinehaulRunId = 42, BookDate = same, BookTime = same });
            seed.TucJobs.Add(new TucJob { UcjbId = 200 + i, UcjbNumber = $"T{i}", LinehaulRunId = 42, UcjbDate = same, UcjbTime = same });
        }
        await seed.SaveChangesAsync();

        var seen = new List<string>();
        for (var p = 1; p <= 4; p++)
        {
            var res = await svc.ListForLinehaulRunAsync(42, page: p, pageSize: 5);
            seen.AddRange(res.Entries.Select(e => $"{e.Source}:{e.Id}"));
        }

        Assert.Equal(18, seen.Count);
        Assert.Equal(18, seen.Distinct().Count());
    }

    [Fact]
    public async Task TieBreakOrdersBySourceThenIdWithinOneTimestamp()
    {
        var svc = NewSvc(out var seed);
        var same = new DateTime(2026, 5, 1, 9, 0, 0);
        seed.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "tuc2", LinehaulRunId = 42, UcjbDate = same, UcjbTime = same });
        seed.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "tuc1", LinehaulRunId = 42, UcjbDate = same, UcjbTime = same });
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 9, JobNumber = "bulk9", LinehaulRunId = 42, BookDate = same, BookTime = same });
        await seed.SaveChangesAsync();

        var res = await svc.ListForLinehaulRunAsync(42);

        // "bulk" < "tuc" ordinally, then Id ascending inside a source.
        Assert.Equal(
            new[] { "bulk9", "tuc1", "tuc2" },
            res.Entries.Select(e => e.JobNumber).ToArray());
    }

    [Theory]
    [InlineData(0, 50)]      // <= 0 falls back to the default
    [InlineData(-5, 50)]
    [InlineData(1, 1)]
    [InlineData(200, 200)]   // at the cap
    [InlineData(5000, 200)]  // above the cap, clamped
    public async Task PageSizeIsClamped(int requested, int expected)
    {
        var svc = NewSvc(out var seed);
        await SeedSpreadAsync(seed, 3);

        var res = await svc.ListForLinehaulRunAsync(42, page: 1, pageSize: requested);

        Assert.Equal(expected, res.PageSize);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task PageNumberBelowOneIsTreatedAsTheFirstPage(int requested)
    {
        var svc = NewSvc(out var seed);
        await SeedSpreadAsync(seed, 3);

        var res = await svc.ListForLinehaulRunAsync(42, page: requested, pageSize: 2);

        Assert.Equal(1, res.Page);
        Assert.Equal(2, res.Entries.Count);
    }

    [Fact]
    public async Task EmptyRunReturnsZeroTotalAndNoEntries()
    {
        var svc = NewSvc(out _);

        var res = await svc.ListForLinehaulRunAsync(42);

        Assert.Equal(0, res.Total);
        Assert.Empty(res.Entries);
    }
}
