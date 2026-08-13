using RoutedOperations.Core.Application.Dtos.Job;
using RoutedOperations.Core.Application.Services.Job;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.Job;

/// <summary>
/// Fully covered:
///   - GetBulkJobsAsync (parent filter, job status filters, per-filter branches,
///     sibling window join, cubic sum, postcode-run-name join, run-order coalesce)
///   - GetClientFiltersAsync, GetOurRefsAsync, GetMultiboxChildrenAsync
///   - GetJobDetailExtrasAsync (hit + miss)
///   - UpdateJobDetailAsync (every switch branch + exception rethrow)
///   - UpdateGpsAsync (ToAddress vs Pickup vs postcode parse)
///   - BulkUpdateRouteDateAsync (success + not-found mixing + rollback)
///
/// Not covered:
///   - regionIds filter branch inside GetBulkJobsAsync: uses SqlQueryRaw
///     against SQL-Server-specific functions (COLLATE DATABASE_DEFAULT,
///     LTRIM/RTRIM composition, LEFT JOIN over a fuzzy address normaliser).
///     SQLite can't emulate any of that. Requires a live SQL Server.
/// </summary>
public class JobServiceTests
{
    private static JobService NewSvc(out Core.Domain.DynamicDespatchDbContext seed)
    {
        var opts = CockpitTestHarness.NewInMemoryOptions();
        seed = CockpitTestHarness.Context(opts);
        return new JobService(CockpitTestHarness.Factory(opts));
    }

    private static (JobService Svc, Core.Domain.DynamicDespatchDbContext Seed,
        System.Data.Common.DbConnection Conn, Microsoft.EntityFrameworkCore.DbContextOptions<Core.Domain.DespatchContext> Opts)
        NewSqliteSvc()
    {
        var (opts, conn) = CockpitTestHarness.NewSqliteOptions();
        var seed = CockpitTestHarness.Context(opts);
        return (new JobService(CockpitTestHarness.Factory(opts)), seed, conn, opts);
    }

    private static TblBulkJob NewJob(int id, DateTime date, int clientId = 1, int speed = 1,
        int? parentId = null, bool done = false, bool @void = false, int? scheduleId = null,
        string jobNumber = "J")
        => new()
        {
            BulkJobId = id, JobNumber = jobNumber + id, BookDate = date,
            BookTime = date, JobStatus = 0, ClientId = clientId, ClientCode = "CLI",
            Speed = speed, FromAddress = "F", ToAddress = "T",
            Done = done, Void = @void, ScheduleId = scheduleId, ParentId = parentId,
        };

    [Fact]
    public async Task GetBulkJobsAsync_EmptyReturnsEmpty()
    {
        var svc = NewSvc(out _);

        var rows = await svc.GetBulkJobsAsync(null, null, null, null, null);

        Assert.Empty(rows);
    }

    [Fact]
    public async Task GetBulkJobsAsync_FiltersDoneAndVoid()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1, MaxJobsPerRun = 20 });
        seed.TblBulkJobs.AddRange(
            NewJob(1, date),
            NewJob(2, date, done: true),
            NewJob(3, date, @void: true));
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(null, null, null, null, null);

        Assert.Single(rows);
        Assert.Equal(1, rows[0].BulkJobId);
    }

    [Fact]
    public async Task GetBulkJobsAsync_FiltersParentIds()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1, MaxJobsPerRun = 20 });
        // Job 1 is a parent (job 2 has ParentId = 1).
        seed.TblBulkJobs.AddRange(
            NewJob(1, date),
            NewJob(2, date, parentId: 1));
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(null, null, null, null, null);

        Assert.Single(rows);
        Assert.Equal(2, rows[0].BulkJobId);
    }

    [Fact]
    public async Task GetBulkJobsAsync_FiltersJobRelationshipType19()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1, MaxJobsPerRun = 20 });
        var linehaulSib = NewJob(1, date);
        linehaulSib.JobRelationshipTypeId = 19;
        var normal = NewJob(2, date);
        seed.TblBulkJobs.AddRange(linehaulSib, normal);
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(null, null, null, null, null);

        Assert.Single(rows);
        Assert.Equal(2, rows[0].BulkJobId);
    }

    [Fact]
    public async Task GetBulkJobsAsync_FiltersLhJobsWhenScheduleForbidsInsertToBulk()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1, MaxJobsPerRun = 20 });
        seed.TblBulkScheduleLinehauls.Add(new TblBulkScheduleLinehaul
        {
            Id = 1, BulkRunScheduleId = 55, InsertToBulk = false,
        });
        var lh = NewJob(1, date, scheduleId: 55, jobNumber: "LH-");
        var normal = NewJob(2, date);
        seed.TblBulkJobs.AddRange(lh, normal);
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(null, null, null, null, null);

        Assert.Single(rows);
        Assert.Equal(2, rows[0].BulkJobId);
    }

    [Fact]
    public async Task GetBulkJobsAsync_DateFilter()
    {
        var svc = NewSvc(out var seed);
        seed.TucClients.Add(new TucClient { UcclId = 1, MaxJobsPerRun = 20 });
        seed.TblBulkJobs.AddRange(
            NewJob(1, new DateTime(2026, 8, 13)),
            NewJob(2, new DateTime(2026, 8, 14)));
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(new DateTime(2026, 8, 13), null, null, null, null);

        Assert.Single(rows);
        Assert.Equal(1, rows[0].BulkJobId);
    }

    [Fact]
    public async Task GetBulkJobsAsync_ClientIdFilter()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.AddRange(
            new TucClient { UcclId = 1 },
            new TucClient { UcclId = 2 });
        seed.TblBulkJobs.AddRange(
            NewJob(1, date, clientId: 1),
            NewJob(2, date, clientId: 2));
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(null, "2", null, null, null);

        Assert.Single(rows);
        Assert.Equal(2, rows[0].BulkJobId);
    }

    [Fact]
    public async Task GetBulkJobsAsync_OurRefFilter()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1 });
        var a = NewJob(1, date); a.OurRef = "A";
        var b = NewJob(2, date); b.OurRef = "B";
        seed.TblBulkJobs.AddRange(a, b);
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(null, null, null, "A", null);

        Assert.Single(rows);
        Assert.Equal(1, rows[0].BulkJobId);
    }

    [Fact]
    public async Task GetBulkJobsAsync_SpeedFilter()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1 });
        seed.TblBulkJobs.AddRange(
            NewJob(1, date, speed: 1),
            NewJob(2, date, speed: 5));
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(null, null, null, null, "5");

        Assert.Single(rows);
        Assert.Equal(2, rows[0].BulkJobId);
    }

    [Fact]
    public async Task GetBulkJobsAsync_JoinsSpeedAndClientData()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1, MaxJobsPerRun = 15 });
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 5, UcjtName = "Express" });
        var j = NewJob(1, date, speed: 5); j.Amount = 100m;
        seed.TblBulkJobs.Add(j);
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(null, null, null, null, null);

        var row = Assert.Single(rows);
        Assert.Equal("Express", row.SpeedName);
        Assert.Equal(15, row.MaxJobsPerRun);
    }

    [Fact]
    public async Task GetBulkJobsAsync_MaxJobsPerRunFallsBackTo20WhenClientNull()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1, MaxJobsPerRun = null });
        seed.TblBulkJobs.Add(NewJob(1, date));
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(null, null, null, null, null);

        Assert.Equal(20, rows.Single().MaxJobsPerRun);
    }

    [Fact]
    public async Task GetBulkJobsAsync_CubicSumsAcrossItems()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1 });
        seed.TblBulkJobs.Add(NewJob(1, date));
        seed.TblBulkJobItems.AddRange(
            new TblBulkJobItems { Id = 1, JobId = 1, Cubic = 2m, Items = 3 }, // 6
            new TblBulkJobItems { Id = 2, JobId = 1, Cubic = null, Items = 2,
                                  Length = 100d, Height = 100d, Depth = 100d }); // 100*100*100 = 1e6 mm3 / 1e6 = 1 m3 * 2 = 2
        await seed.SaveChangesAsync();

        var rows = await svc.GetBulkJobsAsync(null, null, null, null, null);

        Assert.Equal(8m, rows.Single().JobCubicM3);
    }

    [Fact]
    public async Task GetBulkJobsAsync_PostcodeRunNameJoinPopulatesPrefixAndMergeAndSequence()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1 });
        var j = NewJob(1, date); j.ToPostCode = 1010;
        seed.TblBulkJobs.Add(j);
        seed.TblBulkPostCodeRunNames.Add(new TblBulkPostCodeRunName
        {
            Id = 1, PostCode = "1010", RunName = "CBD-A", PostCodeMergeTo = "1011", RunSequence = 3
        });
        await seed.SaveChangesAsync();

        var row = (await svc.GetBulkJobsAsync(null, null, null, null, null)).Single();

        Assert.Equal("CBD-A", row.PrefixRunName);
        Assert.Equal("1011", row.PostCodeMergeTo);
        Assert.Equal(3, row.RunSequence);
    }

    [Fact]
    public async Task GetBulkJobsAsync_MissingPostcodeRunFallsBackToPostcodeAsPrefix()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1 });
        var j = NewJob(1, date); j.ToPostCode = 2020;
        seed.TblBulkJobs.Add(j);
        await seed.SaveChangesAsync();

        var row = (await svc.GetBulkJobsAsync(null, null, null, null, null)).Single();

        Assert.Equal("2020", row.PrefixRunName);
        Assert.Null(row.PostCodeMergeTo);
        Assert.Equal(0, row.RunSequence);
    }

    [Fact]
    public async Task GetBulkJobsAsync_RunOrderPrefersBulkJobRunRow()
    {
        var svc = NewSvc(out var seed);
        var date = new DateTime(2026, 8, 13);
        seed.TucClients.Add(new TucClient { UcclId = 1 });
        var j = NewJob(1, date); j.RunOrder = 99;
        seed.TblBulkJobs.Add(j);
        seed.TblBulkJobRuns.Add(new TblBulkJobRun { Id = 1, BulkJobId = 1, PickRunOrder = 5 });
        await seed.SaveChangesAsync();

        var row = (await svc.GetBulkJobsAsync(null, null, null, null, null)).Single();

        Assert.Equal(5, row.RunOrder);
        Assert.Equal(1, row.BulkJobRunId);
    }

    [Fact]
    public async Task GetJobDetailExtrasAsync_ReturnsDetails()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob
        {
            BulkJobId = 1, JobNumber = "J1", BookDate = DateTime.Today, BookTime = DateTime.Today,
            ClientId = 1, Notes = "n", TrackingEmail = "e", TrackingMobile = "m",
            ProofOfDeliveryEmail = "pe", ProofOfDeliveryMobile = "pm",
        });
        await seed.SaveChangesAsync();

        var extras = await svc.GetJobDetailExtrasAsync(1);

        Assert.NotNull(extras);
        Assert.Equal("n", extras!.Notes);
        Assert.Equal("e", extras.TrackingEmail);
    }

    [Fact]
    public async Task GetJobDetailExtrasAsync_NotFoundReturnsNull()
    {
        var svc = NewSvc(out _);

        var extras = await svc.GetJobDetailExtrasAsync(9999);

        Assert.Null(extras);
    }

    [Fact]
    public async Task GetClientFiltersAsync_ReturnsDistinctActive()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.AddRange(
            new TblBulkJob { BulkJobId = 1, JobNumber = "J1", BookDate = DateTime.Today, BookTime = DateTime.Today,
                             ClientId = 1, ClientCode = "A", Done = false },
            new TblBulkJob { BulkJobId = 2, JobNumber = "J2", BookDate = DateTime.Today, BookTime = DateTime.Today,
                             ClientId = 1, ClientCode = "A", Done = false },
            new TblBulkJob { BulkJobId = 3, JobNumber = "J3", BookDate = DateTime.Today, BookTime = DateTime.Today,
                             ClientId = 2, ClientCode = "B", Done = false },
            new TblBulkJob { BulkJobId = 4, JobNumber = "J4", BookDate = DateTime.Today, BookTime = DateTime.Today,
                             ClientId = 3, ClientCode = "C", Done = true });
        await seed.SaveChangesAsync();

        var filters = await svc.GetClientFiltersAsync();

        Assert.Equal(2, filters.Count);
    }

    [Fact]
    public async Task GetOurRefsAsync_ReturnsDistinctOrderedByRefForDate()
    {
        var svc = NewSvc(out var seed);
        var d = new DateTime(2026, 8, 13);
        seed.TblBulkJobs.AddRange(
            new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = d, BookTime = d, ClientId = 1, OurRef = "Z" },
            new TblBulkJob { BulkJobId = 2, JobNumber = "J", BookDate = d, BookTime = d, ClientId = 1, OurRef = "A" },
            new TblBulkJob { BulkJobId = 3, JobNumber = "J", BookDate = d, BookTime = d, ClientId = 1, OurRef = null },
            new TblBulkJob { BulkJobId = 4, JobNumber = "J", BookDate = d.AddDays(1), BookTime = d, ClientId = 1, OurRef = "X" });
        await seed.SaveChangesAsync();

        var refs = await svc.GetOurRefsAsync(d);

        Assert.Equal(new[] { "A", "Z" }, refs.ToArray());
    }

    [Fact]
    public async Task GetMultiboxChildrenAsync_ReturnsMultiboxAndParentMatches()
    {
        var svc = NewSvc(out var seed);
        var d = DateTime.Today;
        seed.TblBulkJobs.AddRange(
            new TblBulkJob { BulkJobId = 1, JobNumber = "J1", BookDate = d, BookTime = d, ClientId = 1, MultiboxParentId = 100 },
            new TblBulkJob { BulkJobId = 2, JobNumber = "J2", BookDate = d, BookTime = d, ClientId = 1, ParentId = 100 },
            new TblBulkJob { BulkJobId = 3, JobNumber = "J3", BookDate = d, BookTime = d, ClientId = 1 });
        await seed.SaveChangesAsync();

        var kids = await svc.GetMultiboxChildrenAsync(100);

        Assert.Equal(2, kids.Count);
        Assert.Contains(1, kids);
        Assert.Contains(2, kids);
    }

    [Fact]
    public async Task UpdateJobDetailAsync_UpdatesAmountAsDecimal()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J1", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        var ok = await svc.UpdateJobDetailAsync(1, "Amount", "199.50");

        Assert.True(ok);
    }

    [Fact]
    public async Task UpdateJobDetailAsync_UpdatesQtyAsShort()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        var ok = await svc.UpdateJobDetailAsync(1, "Qty", "5");

        Assert.True(ok);
    }

    [Fact]
    public async Task UpdateJobDetailAsync_UpdatesSpeedAsInt()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        var ok = await svc.UpdateJobDetailAsync(1, "Speed", "3");

        Assert.True(ok);
    }

    [Fact]
    public async Task UpdateJobDetailAsync_OkToLeaveMapsToDeliverToPrivateBusiness()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        Assert.True(await svc.UpdateJobDetailAsync(1, "OkToLeave", "true"));
        Assert.True(await svc.UpdateJobDetailAsync(1, "OkToLeave", "false"));
        Assert.True(await svc.UpdateJobDetailAsync(1, "OkToLeave", "1"));
        Assert.True(await svc.UpdateJobDetailAsync(1, "OkToLeave", "   "));
    }

    [Fact]
    public async Task UpdateJobDetailAsync_BookDateAcceptsDdMmYyyy()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        Assert.True(await svc.UpdateJobDetailAsync(1, "BookDate", "13/08/2026"));
    }

    [Fact]
    public async Task UpdateJobDetailAsync_BookDateAcceptsInvariantFallback()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        Assert.True(await svc.UpdateJobDetailAsync(1, "BookDate", "2026-08-13"));
    }

    [Fact]
    public async Task UpdateJobDetailAsync_BookTimeAcceptsMultipleFormats()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        Assert.True(await svc.UpdateJobDetailAsync(1, "BookTime", "14:30"));
        Assert.True(await svc.UpdateJobDetailAsync(1, "BookTime", "14:30:00"));
    }

    [Fact]
    public async Task UpdateJobDetailAsync_BookTimeFallsBackToInvariantParse()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        Assert.True(await svc.UpdateJobDetailAsync(1, "BookTime", "2026-08-13T09:15:00"));
    }

    [Fact]
    public async Task UpdateJobDetailAsync_DefaultBranchWritesRawStringValue()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        Assert.True(await svc.UpdateJobDetailAsync(1, "OurRef", "REFxyz"));
    }

    [Fact]
    public async Task UpdateJobDetailAsync_JobNotFoundReturnsFalse()
    {
        var svc = NewSvc(out _);

        var ok = await svc.UpdateJobDetailAsync(9999, "Amount", "1");

        Assert.False(ok);
    }

    [Fact]
    public async Task UpdateJobDetailAsync_BadValueThrows()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        await Assert.ThrowsAnyAsync<Exception>(() =>
            svc.UpdateJobDetailAsync(1, "Amount", "not-a-number"));
    }

    [Fact]
    public async Task UpdateGpsAsync_ToAddressUpdatesDeliveryAndPostcode()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        var ok = await svc.UpdateGpsAsync(new UpdateGpsRequest
        {
            JobId = 1, Address = "ToAddress", Lat = "-36.85", Lng = "174.76", PostCode = "1010-9999"
        });

        Assert.True(ok);
    }

    [Fact]
    public async Task UpdateGpsAsync_FromAddressUpdatesPickup()
    {
        var svc = NewSvc(out var seed);
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 1, JobNumber = "J", BookDate = DateTime.Today, BookTime = DateTime.Today, ClientId = 1 });
        await seed.SaveChangesAsync();

        var ok = await svc.UpdateGpsAsync(new UpdateGpsRequest
        {
            JobId = 1, Address = "FromAddress", Lat = "1", Lng = "2", PostCode = "abc"
        });

        Assert.True(ok);
    }

    [Fact]
    public async Task UpdateGpsAsync_JobNotFoundReturnsFalse()
    {
        var svc = NewSvc(out _);

        var ok = await svc.UpdateGpsAsync(new UpdateGpsRequest { JobId = 9999, Address = "ToAddress" });

        Assert.False(ok);
    }

    [Fact]
    public async Task BulkUpdateRouteDateAsync_UpdatesFoundJobsMarksMissingOnesFailed()
    {
        var (svc, seed, conn, _) = NewSqliteSvc();
        seed.TblBulkJobs.AddRange(
            new TblBulkJob { BulkJobId = 1, JobNumber = "J1", BookDate = new DateTime(2026, 8, 13), BookTime = new DateTime(2026, 8, 13), ClientId = 1 },
            new TblBulkJob { BulkJobId = 2, JobNumber = "J2", BookDate = new DateTime(2026, 8, 13), BookTime = new DateTime(2026, 8, 13), ClientId = 1 });
        await seed.SaveChangesAsync();

        var res = await svc.BulkUpdateRouteDateAsync(new BulkUpdateRouteDateRequest
        {
            JobIds = new List<int> { 1, 2, 999 },
            NewDate = new DateTime(2026, 9, 1),
            RunName = "R1",
        });

        var props = res.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(res));
        Assert.Equal(2, props["Success"]);
        Assert.Equal(1, props["Failed"]);
        conn.Dispose();
    }

    [Fact]
    public async Task BulkUpdateRouteDateAsync_AllJobsMissingReturnsFailedTotal()
    {
        var (svc, _, conn, _) = NewSqliteSvc();

        var res = await svc.BulkUpdateRouteDateAsync(new BulkUpdateRouteDateRequest
        {
            JobIds = new List<int> { 999 },
            NewDate = new DateTime(2026, 9, 1),
            RunName = "R1",
        });

        var props = res.GetType().GetProperties().ToDictionary(p => p.Name, p => p.GetValue(res));
        Assert.Equal(0, props["Success"]);
        Assert.Equal(1, props["Failed"]);
        conn.Dispose();
    }
}
