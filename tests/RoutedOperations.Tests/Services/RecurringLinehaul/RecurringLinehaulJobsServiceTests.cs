using RoutedOperations.Core.Application.Services.RecurringLinehaul;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.RecurringLinehaul;

/// <summary>
/// Covers RecurringLinehaulJobsService: ListForLinehaulRunAsync (Mapped Stops drill-down),
/// GetDetailAsync (single-job editor payload incl. speed grouping + address join), UpdateSpeedAsync
/// (patch + re-read), GetGroupedSpeedsAsync (Speed dropdown feed grouped by TucJobTypeGrouping).
/// </summary>
public class RecurringLinehaulJobsServiceTests
{
    private static RecurringLinehaulJobsService NewSvc(
        out Core.Domain.DynamicDespatchDbContext seed,
        out Microsoft.EntityFrameworkCore.DbContextOptions<Core.Domain.DespatchContext> opts)
    {
        opts = RecurringLinehaulTestHarness.NewOptions();
        seed = RecurringLinehaulTestHarness.Context(opts);
        return new RecurringLinehaulJobsService(RecurringLinehaulTestHarness.Factory(opts));
    }

    private static RecurringLinehaulJobsService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
        => NewSvc(out seed, out _);

    // ── ListForLinehaulRunAsync ────────────────────────────────────────────

    [Fact]
    public async Task ListForRun_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await svc.ListForLinehaulRunAsync(42);

        Assert.Empty(rows);
    }

    [Fact]
    public async Task ListForRun_ExcludesVoidJobs()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.AddRange(
            new TblBulkJob { BulkJobId = 1, JobNumber = "J1", LinehaulRunId = 42, Void = false, BookDate = DateTime.Today, BookTime = DateTime.Today },
            new TblBulkJob { BulkJobId = 2, JobNumber = "J2", LinehaulRunId = 42, Void = true, BookDate = DateTime.Today, BookTime = DateTime.Today });
        await seed.SaveChangesAsync();

        var rows = await svc.ListForLinehaulRunAsync(42);

        Assert.Single(rows);
        Assert.Equal("J1", rows[0].JobNumber);
    }

    [Fact]
    public async Task ListForRun_ExcludesJobsOnOtherRuns()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.AddRange(
            new TblBulkJob { BulkJobId = 1, JobNumber = "J1", LinehaulRunId = 42, BookDate = DateTime.Today, BookTime = DateTime.Today },
            new TblBulkJob { BulkJobId = 2, JobNumber = "J2", LinehaulRunId = 99, BookDate = DateTime.Today, BookTime = DateTime.Today });
        await seed.SaveChangesAsync();

        var rows = await svc.ListForLinehaulRunAsync(42);

        Assert.Single(rows);
    }

    [Fact]
    public async Task ListForRun_OrdersByBookDateThenBookTimeDescending()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.AddRange(
            new TblBulkJob { BulkJobId = 1, JobNumber = "Older", LinehaulRunId = 42, BookDate = new DateTime(2026, 1, 1), BookTime = new DateTime(2026, 1, 1, 8, 0, 0) },
            new TblBulkJob { BulkJobId = 2, JobNumber = "Newest", LinehaulRunId = 42, BookDate = new DateTime(2026, 2, 1), BookTime = new DateTime(2026, 2, 1, 8, 0, 0) },
            new TblBulkJob { BulkJobId = 3, JobNumber = "SameDayLater", LinehaulRunId = 42, BookDate = new DateTime(2026, 1, 1), BookTime = new DateTime(2026, 1, 1, 16, 0, 0) });
        await seed.SaveChangesAsync();

        var rows = await svc.ListForLinehaulRunAsync(42);

        Assert.Equal(new[] { "Newest", "SameDayLater", "Older" }, rows.Select(r => r.JobNumber).ToArray());
    }

    [Fact]
    public async Task ListForRun_ResolvesSpeedGroupingWhenSpeedKnown()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobTypeGroupings.Add(new TucJobTypeGrouping { GroupingId = 1, GroupingName = "Overnight" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 10, UcjtName = "Overnight-Std", ShortName = "OS", GroupingId = 1 });
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", LinehaulRunId = 42, Speed = 10,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListForLinehaulRunAsync(42)).Single();

        Assert.Equal(10, row.SpeedId);
        Assert.Equal("OS", row.SpeedShortName);
        Assert.Equal("Overnight-Std", row.SpeedName);
        Assert.Equal(1, row.SpeedGroupingId);
        Assert.Equal("Overnight", row.SpeedGroupingName);
    }

    [Fact]
    public async Task ListForRun_UnknownSpeedYieldsEmptyStrings()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", LinehaulRunId = 42, Speed = 999,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListForLinehaulRunAsync(42)).Single();

        Assert.Equal(string.Empty, row.SpeedShortName);
        Assert.Equal(string.Empty, row.SpeedName);
        Assert.Null(row.SpeedGroupingId);
        Assert.Null(row.SpeedGroupingName);
    }

    [Fact]
    public async Task ListForRun_FormatsBookDateAndTime()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", LinehaulRunId = 42,
            BookDate = new DateTime(2026, 8, 15),
            BookTime = new DateTime(2026, 8, 15, 14, 30, 0)
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListForLinehaulRunAsync(42)).Single();

        Assert.Equal("2026-08-15", row.BookDate);
        Assert.Equal("14:30", row.BookTime);
    }

    [Fact]
    public async Task ListForRun_ProjectsPickupAndDrop()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", LinehaulRunId = 42,
            FromAddress = "42 Depot Rd", ToAddress = "13 Airport Way",
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListForLinehaulRunAsync(42)).Single();

        Assert.Equal("42 Depot Rd", row.Pickup);
        Assert.Equal("13 Airport Way", row.Drop);
    }

    [Fact]
    public async Task ListForRun_ResolvesStatusNameWhenPresent()
    {
        var svc = NewSvc(out var seed);
        seed.Set<TucJobStatus>().Add(new TucJobStatus { UcjsId = 2, UcjsName = "Accepted" });
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", LinehaulRunId = 42, JobStatus = 2,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListForLinehaulRunAsync(42)).Single();

        Assert.Equal("Accepted", row.StatusName);
    }

    [Fact]
    public async Task ListForRun_MissingStatusYieldsNullName()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", LinehaulRunId = 42, JobStatus = 42,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var row = (await svc.ListForLinehaulRunAsync(42)).Single();

        Assert.Null(row.StatusName);
    }

    // ── GetDetailAsync ────────────────────────────────────────────────────

    [Fact]
    public async Task GetDetail_MissingReturnsNull()
    {
        var svc = NewSvc(out _);

        var res = await svc.GetDetailAsync(999);

        Assert.Null(res);
    }

    [Fact]
    public async Task GetDetail_ReturnsBasicFields()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", JobStatus = 0,
            BookDate = new DateTime(2026, 8, 15),
            BookTime = new DateTime(2026, 8, 15, 8, 30, 0),
            Notes = "hello"
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.NotNull(res);
        Assert.Equal("J1", res!.JobNumber);
        Assert.Equal("2026-08-15", res.BookDate);
        Assert.Equal("08:30", res.BookTime);
        Assert.Equal("hello", res.Notes);
    }

    [Fact]
    public async Task GetDetail_JoinsCompanyAndAddressAsCommaSeparated()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1",
            FromCompany = "Acme", FromAddress = "42 Depot Rd",
            ToCompany = "Widgets", ToAddress = "13 Airport Way",
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.Equal("Acme, 42 Depot Rd", res!.PickupAddress);
        Assert.Equal("Widgets, 13 Airport Way", res.DropAddress);
    }

    [Fact]
    public async Task GetDetail_JoinsAddressWithMissingCompany()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1",
            FromCompany = null, FromAddress = "42 Depot Rd",
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.Equal("42 Depot Rd", res!.PickupAddress);
    }

    [Fact]
    public async Task GetDetail_JoinsAddressWithMissingAddress()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1",
            FromCompany = "Acme", FromAddress = null,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.Equal("Acme", res!.PickupAddress);
    }

    [Fact]
    public async Task GetDetail_JoinsAddressWhenBothMissingReturnsEmpty()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1",
            FromCompany = null, FromAddress = null,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.Equal(string.Empty, res!.PickupAddress);
    }

    [Fact]
    public async Task GetDetail_SpeedEditableTrueWhenStatusZero()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J1", JobStatus = 0, BookDate = DateTime.Today, BookTime = DateTime.Today });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.True(res!.SpeedEditable);
    }

    [Fact]
    public async Task GetDetail_SpeedEditableTrueWhenStatusTwo()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J1", JobStatus = 2, BookDate = DateTime.Today, BookTime = DateTime.Today });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.True(res!.SpeedEditable);
    }

    [Fact]
    public async Task GetDetail_SpeedEditableFalseWhenStatusThree()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J1", JobStatus = 3, BookDate = DateTime.Today, BookTime = DateTime.Today });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.False(res!.SpeedEditable);
    }

    [Fact]
    public async Task GetDetail_ResolvesCustomerName()
    {
        var svc = NewSvc(out var seed);
        seed.TucClients.Add(new TucClient { UcclId = 500, UcclName = "Acme Ltd" });
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", ClientId = 500,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.Equal("Acme Ltd", res!.Customer);
    }

    [Fact]
    public async Task GetDetail_ResolvesLinehaulRunName()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkRegions.AddRange(
            new TblBulkRegion { BulkRegionId = 1, Name = "A" },
            new TblBulkRegion { BulkRegionId = 2, Name = "B" });
        seed.TblbulkLinehaulRuns.Add(new TblbulkLinehaulRun
        {
            Id = 42, RunName = "Nightly", FromDepotId = 1, ToDepotId = 2, Mode = 1
        });
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", LinehaulRunId = 42,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.Equal("Nightly", res!.LinehaulRunName);
    }

    [Fact]
    public async Task GetDetail_ResolvesStatusName()
    {
        var svc = NewSvc(out var seed);
        seed.Set<TucJobStatus>().Add(new TucJobStatus { UcjsId = 1, UcjsName = "Assigned" });
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", JobStatus = 1,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.Equal("Assigned", res!.StatusName);
    }

    [Fact]
    public async Task GetDetail_ResolvesSpeedGrouping()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobTypeGroupings.Add(new TucJobTypeGrouping { GroupingId = 5, GroupingName = "Flight" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 20, UcjtName = "Priority", ShortName = "PR", GroupingId = 5 });
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", Speed = 20,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1);

        Assert.Equal(20, res!.SpeedId);
        Assert.Equal("Priority", res.SpeedName);
        Assert.Equal("PR", res.SpeedShortName);
        Assert.Equal(5, res.SpeedGroupingId);
        Assert.Equal("Flight", res.SpeedGroupingName);
    }

    // ── UpdateSpeedAsync ──────────────────────────────────────────────────

    [Fact]
    public async Task UpdateSpeed_MissingReturnsNull()
    {
        var svc = NewSvc(out _);

        var res = await svc.UpdateSpeedAsync(999, 10);

        Assert.Null(res);
    }

    [Fact]
    public async Task UpdateSpeed_PersistsAndReturnsDetail()
    {
        var svc = NewSvc(out var seed, out var opts);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", Speed = 10,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var res = await svc.UpdateSpeedAsync(1, 20);

        Assert.NotNull(res);
        Assert.Equal(20, res!.SpeedId);
        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        Assert.Equal(20, verify.TblBulkJobs.Single().Speed);
    }

    // ── GetGroupedSpeedsAsync ─────────────────────────────────────────────

    [Fact]
    public async Task GetGroupedSpeeds_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var res = await svc.GetGroupedSpeedsAsync();

        Assert.Empty(res);
    }

    [Fact]
    public async Task GetGroupedSpeeds_ProjectsAllSpeedFields()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobTypeGroupings.Add(new TucJobTypeGrouping { GroupingId = 1, GroupingName = "Overnight" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 10, UcjtName = "OS", ShortName = "os", GroupingId = 1 });
        await seed.SaveChangesAsync();

        var res = (await svc.GetGroupedSpeedsAsync()).Single();

        Assert.Equal(10, res.Id);
        Assert.Equal("OS", res.Name);
        Assert.Equal("os", res.ShortName);
        Assert.Equal(1, res.GroupingId);
        Assert.Equal("Overnight", res.GroupingName);
    }

    [Fact]
    public async Task GetGroupedSpeeds_OrdersByGroupingNameThenSpeedName()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobTypeGroupings.AddRange(
            new TucJobTypeGrouping { GroupingId = 1, GroupingName = "Overnight" },
            new TucJobTypeGrouping { GroupingId = 2, GroupingName = "Flight" });
        seed.TucJobTypes.AddRange(
            new TucJobType { UcjtId = 1, UcjtName = "OB", GroupingId = 1 },
            new TucJobType { UcjtId = 2, UcjtName = "OA", GroupingId = 1 },
            new TucJobType { UcjtId = 3, UcjtName = "FA", GroupingId = 2 });
        await seed.SaveChangesAsync();

        var res = await svc.GetGroupedSpeedsAsync();

        Assert.Equal(new[] { "FA", "OA", "OB" }, res.Select(r => r.Name).ToArray());
    }

    [Fact]
    public async Task GetGroupedSpeeds_MissingGroupingYieldsNullGroupingName()
    {
        var svc = NewSvc(out var seed);
        // Speed with GroupingId that has no matching Grouping row -> DefaultIfEmpty branch.
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 10, UcjtName = "Orphan", ShortName = "OP", GroupingId = 999 });
        await seed.SaveChangesAsync();

        var res = (await svc.GetGroupedSpeedsAsync()).Single();

        Assert.Null(res.GroupingName);
        Assert.Equal(999, res.GroupingId);
    }

    [Fact]
    public async Task GetGroupedSpeeds_NullShortNameCoercesToEmpty()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobTypeGroupings.Add(new TucJobTypeGrouping { GroupingId = 1, GroupingName = "G" });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 10, UcjtName = "N", ShortName = null, GroupingId = 1 });
        await seed.SaveChangesAsync();

        var res = (await svc.GetGroupedSpeedsAsync()).Single();

        Assert.Equal(string.Empty, res.ShortName);
    }
}
