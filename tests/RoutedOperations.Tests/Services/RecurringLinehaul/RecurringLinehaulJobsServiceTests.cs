using RoutedOperations.Core.Application.Dtos.RecurringLinehaul;
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

    /// <summary>ListForLinehaulRunAsync returns a page since Bug 3 added paging.
    /// Entries is the same flat list these assertions were written against, so the
    /// coverage is unchanged; paging itself is asserted separately below.</summary>
    private static async Task<List<BulkJobListItemDto>> Rows(
        RecurringLinehaulJobsService svc, int runId)
        => (await svc.ListForLinehaulRunAsync(runId)).Entries;

    // ── ListForLinehaulRunAsync ────────────────────────────────────────────

    [Fact]
    public async Task ListForRun_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await Rows(svc, 42);

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

        var rows = await Rows(svc, 42);

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

        var rows = await Rows(svc, 42);

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

        var rows = await Rows(svc, 42);

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

        var row = (await Rows(svc, 42)).Single();

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

        var row = (await Rows(svc, 42)).Single();

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

        var row = (await Rows(svc, 42)).Single();

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

        var row = (await Rows(svc, 42)).Single();

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

        var row = (await Rows(svc, 42)).Single();

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

        var row = (await Rows(svc, 42)).Single();

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


    // ── Bug 3: two-source union + source discriminator ─────────────────────
    //
    // A linehaul leg's child job is written to exactly one of two tables,
    // chosen by the leg's InsertToBulk flag:
    //
    //     IF @InsertToBulk = 1 -> tblBulkJob
    //     ELSE                 -> tucJob
    //
    // dbo.tucJobArchive is not a source. sp_JobArchive only moves void or
    // finished jobs there, which this page has no use for. There is no test for
    // its absence because TucJobArchive deliberately does not map
    // LinehaulRunId - the missing mapping is the guard, and re-adding the source
    // would not compile without also re-adding that property.
    //
    // The tests above all seed tblBulkJob, so they now cover only the bulk
    // branch of the union. These cover the tucJob branch, the ordering across
    // sources, and the id collision that makes the discriminator load-bearing
    // rather than cosmetic.

    [Fact]
    public async Task ListForRun_UnionsBothSourcesAndStampsSource()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "FromBulk", LinehaulRunId = 42,
            BookDate = new DateTime(2026, 3, 1), BookTime = new DateTime(2026, 3, 1, 9, 0, 0)
        });
        seed.TucJobs.Add(new TucJob
        {
            UcjbId = 2, UcjbNumber = "FromTuc", LinehaulRunId = 42,
            UcjbDate = new DateTime(2026, 2, 1), UcjbTime = new DateTime(2026, 2, 1, 9, 0, 0)
        });
        await seed.SaveChangesAsync();

        var rows = await Rows(svc, 42);

        // Ordered newest first, so the sources interleave by date, not by table.
        Assert.Equal(new[] { "FromBulk", "FromTuc" }, rows.Select(r => r.JobNumber).ToArray());
        Assert.Equal(new[] { "bulk", "tuc" }, rows.Select(r => r.Source).ToArray());
    }

    [Fact]
    public async Task ListForRun_OrdersAcrossSourcesNotWithinThem()
    {
        // Deliberately interleaved: if each source were sorted and then simply
        // appended, the result would be Bulk-old, Tuc-new. Only a sort over the
        // combined set puts the tucJob row first.
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "BulkOld", LinehaulRunId = 42,
            BookDate = new DateTime(2026, 1, 1), BookTime = new DateTime(2026, 1, 1, 8, 0, 0)
        });
        seed.TucJobs.Add(new TucJob
        {
            UcjbId = 2, UcjbNumber = "TucNew", LinehaulRunId = 42,
            UcjbDate = new DateTime(2026, 6, 1), UcjbTime = new DateTime(2026, 6, 1, 8, 0, 0)
        });
        await seed.SaveChangesAsync();

        var rows = await Rows(svc, 42);

        Assert.Equal(new[] { "TucNew", "BulkOld" }, rows.Select(r => r.JobNumber).ToArray());
    }

    [Fact]
    public async Task ListForRun_SameIdInTwoSourcesYieldsTwoDistinctRows()
    {
        // BulkJobId and ucjbID are independent identity sequences, so the same
        // integer routinely names a different job in each table. Without Source
        // the drill-down cannot tell these apart and the detail + speed
        // endpoints would resolve the wrong one.
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 7, JobNumber = "BulkSeven", LinehaulRunId = 42,
            BookDate = new DateTime(2026, 5, 1), BookTime = new DateTime(2026, 5, 1, 8, 0, 0)
        });
        seed.TucJobs.Add(new TucJob
        {
            UcjbId = 7, UcjbNumber = "TucSeven", LinehaulRunId = 42,
            UcjbDate = new DateTime(2026, 4, 1), UcjbTime = new DateTime(2026, 4, 1, 8, 0, 0)
        });
        await seed.SaveChangesAsync();

        var rows = await Rows(svc, 42);

        Assert.Equal(2, rows.Count);
        Assert.All(rows, r => Assert.Equal(7, r.Id));
        Assert.Equal(new[] { "bulk", "tuc" }, rows.Select(r => r.Source).ToArray());
    }

    [Fact]
    public async Task ListForRun_DeduplicatesAPushedLegPresentOnBothTables()
    {
        // When a bulk job goes live, tblBulkJob.JobID is back-filled with the new
        // tucJob.ucjbID. If that tucJob row also carries LinehaulRunId the same
        // shipment satisfies both branches of the union. urgent-prod 2026-09-30 had
        // 171 such pairs, and on three runs EVERY tucJob row was one of them.
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 500, JobId = 900, JobNumber = "PushedLeg", LinehaulRunId = 42,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        seed.TucJobs.Add(new TucJob
        {
            UcjbId = 900, UcjbNumber = "PushedLeg", LinehaulRunId = 42, UcjbDate = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var rows = await Rows(svc, 42);

        // One row, and it is the bulk one: that is the id the UI has always used.
        var row = Assert.Single(rows);
        Assert.Equal("bulk", row.Source);
        Assert.Equal(500, row.Id);
    }

    [Fact]
    public async Task ListForRun_KeepsATucRowWhoseBulkCounterpartIsOnAnotherRun()
    {
        // The de-duplication is per run. A bulk row pointing at the same tucJob but
        // carrying a different run id must not suppress it.
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 500, JobId = 900, JobNumber = "OtherRunBulk", LinehaulRunId = 99,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        seed.TucJobs.Add(new TucJob
        {
            UcjbId = 900, UcjbNumber = "WantedTuc", LinehaulRunId = 42, UcjbDate = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var row = Assert.Single(await Rows(svc, 42));

        Assert.Equal("tuc", row.Source);
        Assert.Equal(900, row.Id);
    }

    [Fact]
    public async Task ListForRun_KeepsATucRowWhoseBulkCounterpartIsVoid()
    {
        // A voided bulk row is filtered out of the bulk branch, so suppressing the
        // tuc row on account of it would drop the stop from the list entirely.
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 500, JobId = 900, JobNumber = "VoidBulk", LinehaulRunId = 42, Void = true,
            BookDate = DateTime.Today, BookTime = DateTime.Today
        });
        seed.TucJobs.Add(new TucJob
        {
            UcjbId = 900, UcjbNumber = "LiveTuc", LinehaulRunId = 42, UcjbDate = DateTime.Today
        });
        await seed.SaveChangesAsync();

        var row = Assert.Single(await Rows(svc, 42));

        Assert.Equal("tuc", row.Source);
        Assert.Equal("LiveTuc", row.JobNumber);
    }

    [Fact]
    public async Task ListForRun_ExcludesVoidRowsFromTucToo()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobs.AddRange(
            new TucJob { UcjbId = 1, UcjbNumber = "TucLive", LinehaulRunId = 42, UcjbVoid = false, UcjbDate = DateTime.Today },
            new TucJob { UcjbId = 2, UcjbNumber = "TucVoid", LinehaulRunId = 42, UcjbVoid = true, UcjbDate = DateTime.Today });
        await seed.SaveChangesAsync();

        var rows = await Rows(svc, 42);

        Assert.Equal("TucLive", Assert.Single(rows).JobNumber);
    }

    [Fact]
    public async Task ListForRun_ExcludesTucRowsOnOtherRuns()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobs.Add(new TucJob { UcjbId = 1, UcjbNumber = "Wanted", LinehaulRunId = 42, UcjbDate = DateTime.Today });
        seed.TucJobs.Add(new TucJob { UcjbId = 2, UcjbNumber = "OtherRun", LinehaulRunId = 99, UcjbDate = DateTime.Today });
        await seed.SaveChangesAsync();

        var rows = await Rows(svc, 42);

        Assert.Equal("Wanted", Assert.Single(rows).JobNumber);
    }

    [Fact]
    public async Task ListForRun_TucRowProjectsAddressesAndNullBookTime()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobs.Add(new TucJob
        {
            UcjbId = 1, UcjbNumber = "T1", LinehaulRunId = 42,
            UcjbFromAddr = "42 Depot Rd", UcjbToAddr = "13 Airport Way",
            UcjbDate = new DateTime(2026, 8, 15), UcjbTime = null
        });
        await seed.SaveChangesAsync();

        var row = Assert.Single(await Rows(svc, 42));

        Assert.Equal("42 Depot Rd", row.Pickup);
        Assert.Equal("13 Airport Way", row.Drop);
        Assert.Equal("2026-08-15", row.BookDate);
        Assert.Null(row.BookTime);
    }

    // ── Bug 3: GetDetailAsync dispatch ─────────────────────────────────────

    [Fact]
    public async Task GetDetail_OmittedSourceStillReadsBulk()
    {
        // Back-compat: a client written before Bug 3 sends no source at all.
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobNumber = "Bulk5", BookDate = DateTime.Today, BookTime = DateTime.Today });
        seed.TucJobs.Add(new TucJob { UcjbId = 5, UcjbNumber = "Tuc5", UcjbDate = DateTime.Today });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(5);

        Assert.Equal("Bulk5", res!.JobNumber);
        Assert.Equal("bulk", res.Source);
    }

    [Fact]
    public async Task GetDetail_SourceTucReadsTucJobNotBulk()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobNumber = "Bulk5", BookDate = DateTime.Today, BookTime = DateTime.Today });
        seed.TucJobs.Add(new TucJob { UcjbId = 5, UcjbNumber = "Tuc5", UcjbDate = DateTime.Today });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(5, "tuc");

        Assert.Equal("Tuc5", res!.JobNumber);
        Assert.Equal("tuc", res.Source);
    }



    [Fact]
    public async Task GetDetail_TucSpeedEditableFollowsStatus()
    {
        var svc = NewSvc(out var seed);
        seed.TucJobs.AddRange(
            new TucJob { UcjbId = 1, UcjbNumber = "Open", UcjbStatus = 2, UcjbDate = DateTime.Today },
            new TucJob { UcjbId = 2, UcjbNumber = "PickedUp", UcjbStatus = 3, UcjbDate = DateTime.Today });
        await seed.SaveChangesAsync();

        Assert.True((await svc.GetDetailAsync(1, "tuc"))!.SpeedEditable);
        Assert.False((await svc.GetDetailAsync(2, "tuc"))!.SpeedEditable);
    }

    [Fact]
    public async Task GetDetail_TucCompanyNameComesFromAddressLine1()
    {
        // tucJob has no FromCompany column. ucjbFrom is a suburb id
        // (tucJob.ucjbFrom -> tucSuburb.ucsuID), and the linehaul insert writes
        // the company into PickupAddressLine1 / DeliveryAddressLine1.
        var svc = NewSvc(out var seed);
        seed.TucJobs.Add(new TucJob
        {
            UcjbId = 1, UcjbNumber = "T1", UcjbDate = DateTime.Today,
            PickupAddressLine1 = "Acme", UcjbFromAddr = "42 Depot Rd",
            DeliveryAddressLine1 = "Widgets", UcjbToAddr = "13 Airport Way"
        });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(1, "tuc");

        Assert.Equal("Acme, 42 Depot Rd", res!.PickupAddress);
        Assert.Equal("Widgets, 13 Airport Way", res.DropAddress);
    }

    [Fact]
    public async Task GetDetail_UnrecognisedSourceFallsBackToBulk()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobNumber = "Bulk5", BookDate = DateTime.Today, BookTime = DateTime.Today });
        await seed.SaveChangesAsync();

        var res = await svc.GetDetailAsync(5, "nonsense");

        Assert.Equal("Bulk5", res!.JobNumber);
        Assert.Equal("bulk", res.Source);
    }

    // ── Bug 3: UpdateSpeedAsync dispatch ──────────────────────────────────

    [Fact]
    public async Task UpdateSpeed_SourceTucWritesTucJobAndLeavesBulkAlone()
    {
        var svc = NewSvc(out var seed, out var opts);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobNumber = "Bulk5", Speed = 10, BookDate = DateTime.Today, BookTime = DateTime.Today });
        seed.TucJobs.Add(new TucJob { UcjbId = 5, UcjbNumber = "Tuc5", UcjbSpeed = 10, UcjbDate = DateTime.Today });
        await seed.SaveChangesAsync();

        var res = await svc.UpdateSpeedAsync(5, 20, "tuc");

        Assert.Equal(20, res!.SpeedId);
        Assert.Equal("tuc", res.Source);
        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        Assert.Equal(20, verify.TucJobs.Single().UcjbSpeed);
        Assert.Equal(10, verify.TblBulkJobs.Single().Speed);
    }

    [Fact]
    public async Task UpdateSpeed_OmittedSourceStillWritesBulk()
    {
        var svc = NewSvc(out var seed, out var opts);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobNumber = "Bulk5", Speed = 10, BookDate = DateTime.Today, BookTime = DateTime.Today });
        seed.TucJobs.Add(new TucJob { UcjbId = 5, UcjbNumber = "Tuc5", UcjbSpeed = 10, UcjbDate = DateTime.Today });
        await seed.SaveChangesAsync();

        await svc.UpdateSpeedAsync(5, 20);

        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        Assert.Equal(20, verify.TblBulkJobs.Single().Speed);
        Assert.Equal(10, verify.TucJobs.Single().UcjbSpeed);
    }

    [Fact]
    public async Task UpdateSpeed_UnrecognisedSourceWritesBulk()
    {
        // Same fallback as the read path, so a stale or hand-typed source cannot
        // silently land the write on the other table.
        var svc = NewSvc(out var seed, out var opts);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 5, JobNumber = "Bulk5", Speed = 10, BookDate = DateTime.Today, BookTime = DateTime.Today });
        seed.TucJobs.Add(new TucJob { UcjbId = 5, UcjbNumber = "Tuc5", UcjbSpeed = 10, UcjbDate = DateTime.Today });
        await seed.SaveChangesAsync();

        await svc.UpdateSpeedAsync(5, 20, "archive");

        using var verify = RecurringLinehaulTestHarness.Verify(opts);
        Assert.Equal(20, verify.TblBulkJobs.Single().Speed);
        Assert.Equal(10, verify.TucJobs.Single().UcjbSpeed);
    }

    [Fact]
    public async Task UpdateSpeed_SourceTucMissingReturnsNull()
    {
        var svc = NewSvc(out _);

        Assert.Null(await svc.UpdateSpeedAsync(999, 10, "tuc"));
    }
}
