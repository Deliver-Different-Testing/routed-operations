using RoutedOperations.Core.Application.Dtos.BulkImport.Bulk;
using RoutedOperations.Core.Application.Dtos.BulkImport.Common;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Application.Services.BulkImport;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;

namespace RoutedOperations.Tests.Services.BulkImport;

// UC #881 F3. Notes, completion times and the "recent jobs" window are the
// tenant's clock, not the web server's. Before this a US tenant served from an
// NZ host saw tomorrow's date in its notes and completion times, and the job
// list cut off on the host's day.
public class BulkImportTenantClockTests
{
    private static BulkImportServiceV2 Svc(out DynamicDespatchDbContext seed) =>
        BulkImportServiceV2CoreTests.NewSvc(out seed, out _, clientTypeId: "4", timeZone: BulkImportTenantClock.Zone);

    [Fact]
    public async Task Delete_note_is_stamped_in_tenant_time()
    {
        var svc = Svc(out var seed);
        seed.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "N1", UcjbStatus = 0 });
        await seed.SaveChangesAsync();

        Assert.True((await svc.DeleteTucJob(1, new IdRequest { Id = 10 })).Success);

        await seed.Entry(seed.TucJobs.Find(10)!).ReloadAsync();
        BulkImportTenantClock.AssertNoteNear(seed.TucJobs.Find(10)!.UcjbNotes);
    }

    [Fact]
    public async Task Bulk_complete_stamps_note_and_completion_time_in_tenant_time()
    {
        var svc = Svc(out var seed);
        seed.TucJobs.AddRange(
            new TucJob { UcjbId = 10, UcjbNumber = "N1", UcjbClientId = 5 },
            new TucJob { UcjbId = 11, UcjbNumber = "N1-1", UcjbClientId = 5, ParentId = 10 });
        await seed.SaveChangesAsync();

        var resp = await svc.BulkCompleteJobs(1, new BulkJobCompleteRequest
        {
            ClientId = 5,
            JobType = "ondemand",
            Jobs = new List<BulkJobCompleteItem> { new() { JobId = 10, JobNumber = "N1" } },
        });

        Assert.True(resp.Success);
        foreach (var id in new[] { 10, 11 })
        {
            await seed.Entry(seed.TucJobs.Find(id)!).ReloadAsync();
            var job = seed.TucJobs.Find(id)!;
            BulkImportTenantClock.AssertNear(job.UcjbComplTime);
            BulkImportTenantClock.AssertNoteNear(job.UcjbNotes);
        }
    }

    [Fact]
    public async Task Job_list_window_runs_on_the_tenant_date()
    {
        var svc = Svc(out var seed);
        var tenantToday = BulkImportTenantClock.Now.Date;
        seed.TucJobTypes.Add(new TucJobType { UcjtId = 3, UcjtName = "Standard" });
        seed.TucJobs.Add(new TucJob { UcjbId = 10, UcjbNumber = "OLDEST", UcjbClientId = 5, SourceId = 3, UcjbSpeed = 3, UcjbDate = tenantToday.AddDays(-30) });
        seed.TblBulkJobs.Add(new TblBulkJob { BulkJobId = 20, JobNumber = "TODAY", ClientId = 5, SourceId = 3, BookDate = tenantToday, SpeedNavigation = seed.TucJobTypes.Local.First() });
        await seed.SaveChangesAsync();

        var resp = await svc.GetBulkJobs(1, Guid.NewGuid());

        Assert.True(resp.Success);
        Assert.Contains(resp.Jobs, j => j.JobNumber == "OLDEST");
        Assert.Contains(resp.Jobs, j => j.JobNumber == "TODAY");
    }
}
