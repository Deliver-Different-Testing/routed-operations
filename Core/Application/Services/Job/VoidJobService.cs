using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using RoutedOperations.Core.Application.Dtos.Job;
using RoutedOperations.Core.Domain;
using RoutedOperations.Core.Domain.Despatch;
using Serilog;

namespace RoutedOperations.Core.Application.Services.Job;

/// <summary>
/// Ports the legacy VoidJobsAsync flow: auto-managed "Void Jobs" run per date,
/// EF transaction, symmetric void / un-void behaviour. No SP - the legacy
/// version was already pure EF.
/// </summary>
public class VoidJobService(IDbContextFactory<DynamicDespatchDbContext> contextFactory)
    : BaseService(contextFactory)
{
    public async Task<object> VoidAsync(VoidJobsRequest request)
    {
        var successCount = 0;
        var failureCount = 0;
        int? voidRunId = null;

        await using var transaction = await Context.Database.BeginTransactionAsync();
        try
        {
            var jobsToUpdate = await Context.TblBulkJobs
                .Where(job => request.JobIds.Contains(job.BulkJobId))
                .ToListAsync();

            var notFoundIds = request.JobIds
                .Except(jobsToUpdate.Select(j => j.BulkJobId))
                .ToList();
            failureCount = notFoundIds.Count;

            if (request.IsVoid)
            {
                var runDate = request.RunDate.Date;

                var voidRun = await Context.TblBulkRuns
                    .FirstOrDefaultAsync(r => r.Name == "Void Jobs"
                        && r.DespatchDateTime.HasValue
                        && r.DespatchDateTime.Value.Date == runDate);

                if (voidRun == null)
                {
                    voidRun = new TblBulkRun
                    {
                        Name = "Void Jobs",
                        Mins = 0,
                        Kms = 0,
                        // Void Jobs run must be locked (Status = 1) so it never
                        // appears in the operator's Ready list and so its jobs
                        // stay pinned. Matches legacy homeControl.js:1259
                        // ("locked=1 always" on the Void Jobs run).
                        Status = 1,
                        // IsVoidRun distinguishes it from a real dispatched
                        // run in the RunList render. Migration 20260717090000
                        // adds this column with a safe DEFAULT 0 so legacy
                        // rows stay unchanged.
                        IsVoidRun = true,
                        DespatchDateTime = runDate,
                        Created = DateTime.Now,
                        LastModified = DateTime.Now
                    };
                    Context.TblBulkRuns.Add(voidRun);
                    await Context.SaveChangesAsync();
                }
                else if (!voidRun.IsVoidRun || voidRun.Status != 1)
                {
                    // Existing run created before the migration - upgrade in
                    // place so its display / lock behaviour matches spec.
                    voidRun.IsVoidRun = true;
                    voidRun.Status = 1;
                    await Context.SaveChangesAsync();
                }

                voidRunId = voidRun.Id;

                foreach (var job in jobsToUpdate)
                {
                    job.Void = true;
                    job.JobStatus = 1000;
                    Context.Entry(job).State = EntityState.Modified;

                    var existingJobRun = await Context.TblBulkJobRuns
                        .FirstOrDefaultAsync(jr => jr.BulkJobId == job.BulkJobId);

                    if (existingJobRun != null)
                    {
                        existingJobRun.RunId = voidRun.Id;
                        existingJobRun.PickRunOrder = null;
                    }
                    else
                    {
                        Context.TblBulkJobRuns.Add(new TblBulkJobRun
                        {
                            RunId = voidRun.Id,
                            BulkJobId = job.BulkJobId,
                            PickRunOrder = null
                        });
                    }

                    job.BulkRunId = voidRun.Id;
                    successCount++;
                }
            }
            else
            {
                foreach (var job in jobsToUpdate)
                {
                    job.Void = false;
                    job.JobStatus = 0;
                    job.BulkRunId = null;
                    Context.Entry(job).State = EntityState.Modified;

                    var existingJobRun = await Context.TblBulkJobRuns
                        .FirstOrDefaultAsync(jr => jr.BulkJobId == job.BulkJobId);
                    if (existingJobRun != null)
                        Context.TblBulkJobRuns.Remove(existingJobRun);

                    successCount++;
                }

                var runDate = request.RunDate.Date;
                var voidRun = await Context.TblBulkRuns
                    .FirstOrDefaultAsync(r => r.Name == "Void Jobs"
                        && r.DespatchDateTime.HasValue
                        && r.DespatchDateTime.Value.Date == runDate);

                if (voidRun != null)
                {
                    var remaining = await Context.TblBulkJobRuns
                        .CountAsync(jr => jr.RunId == voidRun.Id
                            && jr.BulkJobId.HasValue
                            && !request.JobIds.Contains(jr.BulkJobId.Value));

                    if (remaining == 0)
                        Context.TblBulkRuns.Remove(voidRun);
                    else
                        voidRunId = voidRun.Id;
                }
            }

            if (successCount > 0)
            {
                await Context.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            else
            {
                await transaction.RollbackAsync();
            }

            var action = request.IsVoid ? "void" : "un-void";
            var jobNumbers = jobsToUpdate.Select(j => j.JobNumber);
            Log.Information("Bulk {Action} completed: {Success} ok, {Failed} failed. Jobs: {Jobs}",
                action, successCount, failureCount, JsonConvert.SerializeObject(jobNumbers));

            return new
            {
                Success = successCount,
                Failed = failureCount,
                VoidRunId = voidRunId,
                Message = $"{(request.IsVoid ? "Voided" : "Un-voided")} {successCount} jobs, {failureCount} failed"
            };
        }
        catch (Exception e)
        {
            await transaction.RollbackAsync();
            Log.Error(e, "Bulk {Action} operation failed", request.IsVoid ? "void" : "un-void");
            return new
            {
                Success = 0,
                Failed = request.JobIds.Count,
                VoidRunId = (int?)null,
                Message = $"Bulk {(request.IsVoid ? "void" : "un-void")} failed: " +
                          (e.InnerException?.Message ?? e.Message)
            };
        }
    }
}
