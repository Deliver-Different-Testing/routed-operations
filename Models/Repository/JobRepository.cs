using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;
using RunBuilder.Models.Requests;
using Serilog;
using UCLRun;


namespace RunBuilder.Models.Repository
{
    public class JobRepository(IDbContextFactory<DynamicDespatchDbContext> contextFactory) : BaseRepository(contextFactory)
    {
        public TblBulkJob? GetBulkJobById(int jobId)
        {
            return Context.TblBulkJobs.Find(jobId);
        }



        public async Task<List<UTL_stpJob_tblBulkJobWithFilterResult>> GetBulkJobsAsync(DateTime? dateTime, string clientIds, string regionIds, string ourRefs, string speeds)
        {

            var jobsResult = await Context.Procedures.UTL_stpJob_tblBulkJobWithFilterAsync(dateTime, clientIds == "" ? null : clientIds, regionIds == "" ? null : regionIds, ourRefs == "" ? null : ourRefs, speeds == "" ? null : speeds);

            return jobsResult;
        }



        public bool Update(TblBulkJob bulkJob, string propertyName, string value)
        {
            var result = false;
            try
            {
                switch (propertyName)
                {
                    case "Amount":
                    case "Weight":
                        Context.Entry(bulkJob).Property(propertyName).CurrentValue = Convert.ToDecimal(value);
                        break;
                    case "Qty":
                        Context.Entry(bulkJob).Property(propertyName).CurrentValue = Convert.ToInt16(value);
                        break;
                    case "Speed":
                        Context.Entry(bulkJob).Property(propertyName).CurrentValue = Convert.ToInt32(value);
                        break;
                    case "BookDate":
                        // Parse date in DD/MM/YYYY format (as sent from frontend)
                        DateTime bookDate;
                        if (DateTime.TryParseExact(value, "dd/MM/yyyy",
                            System.Globalization.CultureInfo.InvariantCulture,
                            System.Globalization.DateTimeStyles.None, out bookDate))
                        {
                            Context.Entry(bulkJob).Property(propertyName).CurrentValue = bookDate;
                        }
                        else
                        {
                            // Fallback: try other common formats
                            Context.Entry(bulkJob).Property(propertyName).CurrentValue = DateTime.Parse(value,
                                System.Globalization.CultureInfo.InvariantCulture);
                        }
                        break;
                    case "BookTime":
                        // Parse time in HH:mm:ss format (as sent from frontend)
                        DateTime bookTime;
                        var timeFormats = new[] { "HH:mm:ss", "HH:mm", "h:mm tt", "h:mm:ss tt" };
                        if (DateTime.TryParseExact(value, timeFormats,
                            System.Globalization.CultureInfo.InvariantCulture,
                            System.Globalization.DateTimeStyles.None, out bookTime))
                        {
                            Context.Entry(bulkJob).Property(propertyName).CurrentValue = bookTime;
                        }
                        else
                        {
                            // Fallback: try parsing as a full datetime
                            Context.Entry(bulkJob).Property(propertyName).CurrentValue = DateTime.Parse(value,
                                System.Globalization.CultureInfo.InvariantCulture);
                        }
                        break;
                    default:
                        Context.Entry(bulkJob).Property(propertyName).CurrentValue = value;
                        break;
                }

                Context.Entry(bulkJob).State = EntityState.Modified;
                Context.SaveChanges();
                result = true;
            }
            catch (Exception e)
            {
                result = false;
                throw;
            }

            return result;
        }

        public bool UpdateBulkJob(TblBulkJob bulkJob)
        {
            var result = false;
            Context.Entry(bulkJob).State = EntityState.Modified;
            Context.SaveChanges();
            result = true;

            return result;
        }

        public async Task<List<Response>> InsertJobsAsync(IEnumerable<RunJob> runJobs)
        {
            var result = new List<Response>();
            foreach (var run in runJobs)
            {
                var runName = run.Name;

                float courierPercentage = 0;
                if (run.CourierPercent != null)
                {
                    courierPercentage = float.Parse(run.CourierPercent.TrimEnd(new char[] { '%', ' ' })) / 100;
                }

                var courierId = run.Courier?.courierID;
                var runOrder = 1;
                foreach (var job in run.Jobs)
                {
                    result.Add(await InsertJobAsync(job.BulkJobID, courierId, runName, runOrder++, courierPercentage, run.Status));
                }
            }
            return result;
        }

        public async Task<Response> InsertJobAsync(int jobId, int? courierId, string runName, int runOrder, float courierPercentage, int? runStatus)
        {
            try
            {
                await Context.Procedures.UTL_stpJob_InsertFromRunBuilderAsync(jobId, courierId, runName, runOrder, courierPercentage, runStatus);
                return new Response
                {
                    Result = "Success"
                };
            }
            catch (Exception e)
            {
                return new Response
                {
                    Result = "Failed",
                    Message = (e.InnerException == null ? e.Message : e.InnerException.Message)
                };
            }
        }

        public async Task<Response> SyncHDJobs(DateTime date)
        {
            try
            {
                await Context.Procedures.UTL_stpJob_tblBulkJob_SyncHDJobsAsync(date);
                return new Response
                {
                    Result = "Success"
                };
            }
            catch (Exception e)
            {
                return new Response
                {
                    Result = "Failed",
                    Message = (e.InnerException == null ? e.Message : e.InnerException.Message)
                };
            }
        }

        public async Task<object> GetBulkRunSettingsAsync()
        {
            var settings = await Context.Procedures.UTL_stpJob_tblBulkRunSettingsAsync();

            var clientResult = settings.Select(r => new
            {
                id = r.ClientID,
                label = r.ClientCode
            }).Distinct().ToList();

            var result = new
            {
                clients = clientResult
            };


            return result;
        }

        public async Task<List<Region>> GetRegionListAsync(DateTime runDate)
        {
            var result = await Context.Procedures.RVW_stpBulkRegionsAsync(runDate);
            var regions = result.ToList()
            .Where(x => x.Active == true)
            .Select(x => new Region() { id = x.siteID, label = x.Name })
            .ToList();
            return regions;
        }

        public async Task<List<Speed>> SpeedListAsync(DateTime runDate)
        {
            var result = await Context.Procedures.RVW_stpBulkSpeedsAsync(runDate);
            var speeds = result.ToList()
            .Select(x => new Speed() { id = x.SpeedId, label = x.Name })
            .Distinct()
            .ToList();
            return speeds;
        }

        public async Task<List<Speed>> AllSpeedsAsync()
        {
            var result = await Context.SqlQueryToListAsync<RVW_stpBulkSpeedsResult>(
                "SELECT ucjtID AS SpeedId, ucjtName AS Name FROM tucJobType ORDER BY ucjtName");
            var speeds = result
                .Select(x => new Speed() { id = x.SpeedId, label = x.Name })
                .ToList();
            return speeds;
        }

        public async Task<object> GetFilter(DateTime date)
        {
            var data = await Context.Procedures.UTL_stpJob_tblBulkJobWithFilterAsync(date, null, null, null, null);
            var refs = data.ToList()
            .OrderBy(x => x.OurRef)
            .Select(x => x.OurRef)
            .Distinct().ToList();

            var result = new { OurRefs = refs };

            return result;

        }

        public async Task<List<UTL_stpJob_tblBulkRunWithFilterResult>> GetBulkRunsAsync(DateTime? datetime, string clientIds, string regionIds, string ourRefs, string speeds)
        {
            var data = await Context.Procedures.UTL_stpJob_tblBulkRunWithFilterAsync(datetime, clientIds == "" ? null : clientIds, regionIds == "" ? null : regionIds, ourRefs == "" ? null : ourRefs, speeds == "" ? null : speeds);

            return data;
        }

        public async Task DeleteBulkRunAsync(int id)
        {
            // Get run detail
            var jobs = Context.TblBulkJobRuns.Where(jr => jr.RunId == id)
                .Select(j => j.BulkJob).ToList();
            var jobNumbers = from j in jobs
                             select j.JobNumber;

            var run = await Context.TblBulkRuns.FindAsync(id);
            await Context.Procedures.UTL_stpJob_tblBulkRun_DeleteAsync(id);
            Log.Information($"{jobNumbers.Count()} Jobs {JsonConvert.SerializeObject(jobNumbers)} have been removed from the run {run?.Name}");
            Log.Information($"Run {run?.Name} has been deleted");
        }

        public async Task<Response> InsertOrUpdateRunAsync(RunJob run)
        {
            float courierPercentage = 0;
            if (run.CourierPercent != null && run.CourierPercent != "NaN%")
            {
                courierPercentage = float.Parse(run.CourierPercent.TrimEnd(new char[] { '%', ' ' })) / 100;
            }

            var googleRouteResponse = JsonConvert.SerializeObject(run.GoogleRouteResponse);

            // Insert or update the run detail
            var runResult = await Context.Procedures.UTL_stpJob_tblBulkRun_InsertOrUpdateAsync(run.ID, run.Name, run.Mins, run.Kms, run.Courier?.courierID,
                run.Status, run.Revenue, run.Payout, courierPercentage, googleRouteResponse, null);

            if (runResult.Count == 0)
            {
                return new Response
                {
                    Result = "Failed",
                    Message = "Run insert/update failed"
                };
            }

            // Insert or update the job's run detail
            foreach (var job in run.Jobs)
            {
                // Insert run order into table
                await Context.Procedures.UTL_stpJob_tblBulkJobRun_InsertOrUpdateAsync(runResult.First().RunID, job.BulkJobID, job.BuilderIndex);
            }
            var jobNumbers = from j in run.Jobs
                             select j.JobNumber;
            Log.Information($"{run.Jobs.Count()} Jobs {JsonConvert.SerializeObject(jobNumbers)} have been inserted or updated into the run {run.Name}");

            return new Response
            {
                Result = "Success",

                Message = runResult.First().RunID.ToString()
            };
        }

        public async Task<Response> UpdateRun(RunJob run)
        {

            float courierPercentage = 0;
            if (run.CourierPercent != null && run.CourierPercent != "NaN%")
            {
                courierPercentage = float.Parse(run.CourierPercent.TrimEnd(new char[] { '%', ' ' })) / 100;
            }

            var googleRouteResponse = JsonConvert.SerializeObject(run.GoogleRouteResponse);

            var runToUpdate = await Context.TblBulkRuns.FindAsync(run.ID);

            if (runToUpdate == null)
            {
                return new Response
                {
                    Result = "Failed",
                    Message = "Can not find the run to update!"
                };
            }

            runToUpdate.Id = run.ID.Value;
            runToUpdate.Name = run.Name;
            runToUpdate.Mins = run.Mins;
            runToUpdate.Kms = run.Kms;
            runToUpdate.CourierId = run.Courier?.courierID;
            runToUpdate.Status = run.Status;
            runToUpdate.Revenue = run.Revenue;
            runToUpdate.Payout = run.Payout;
            runToUpdate.CourierPercentage = courierPercentage;
            runToUpdate.GoogleRouteResponse = googleRouteResponse;
            runToUpdate.LastModified = DateTime.Now;


            await Context.SaveChangesAsync();


            Log.Information($"Run {run.Name} has been updated");

            return new Response
            {
                Result = "Success",
                // Store RunID into message
                Message = runToUpdate.Id.ToString()
            };


        }

        public async Task<Response> UpdateBulkJobRun(int jobId, int? fromRunId, int runId)
        {
            // Anchor on BulkJobID. The DB has a unique filtered index on BulkJobID and the
            // upsert SP MERGEs under HOLDLOCK, so concurrent move-job-to-run callers can't
            // both observe "not exists" and double-insert, and a stale fromRunId can't
            // leave the row pointing at an old run.
            var existing = await Context.TblBulkJobRuns.FirstOrDefaultAsync(x => x.BulkJobId == jobId);

            if (fromRunId.HasValue && existing != null && existing.RunId != fromRunId.Value)
            {
                // Caller asserted the job was on fromRunId; another operator has already
                // moved it. Surface the conflict so the FE can refresh instead of silently
                // overwriting the other user's edit.
                Log.Warning($"UpdateBulkJobRun conflict: BulkJobID {jobId} expected on RunID {fromRunId} but is on RunID {existing.RunId}; not moved to RunID {runId}");
                return new Response
                {
                    Result = "Failed",
                    Message = "Job has been moved by another user. Please refresh."
                };
            }

            int? previousRunId = existing?.RunId;

            if (existing != null)
            {
                if (existing.RunId != runId)
                {
                    existing.RunId = runId;
                    await Context.SaveChangesAsync();
                }
            }
            else
            {
                Context.TblBulkJobRuns.Add(new TblBulkJobRun { BulkJobId = jobId, RunId = runId });
                await Context.SaveChangesAsync();
            }

            Log.Information($"BulkJobID {jobId} moved to RunID {runId} (previousRunID: {previousRunId?.ToString() ?? "none"})");

            return new Response
            {
                Result = "Success",
                Message = jobId.ToString()
            };
        }

        public async Task<Response> DeleteBulkJobRun(int jobId)
        {
            var jobRunToDelete = await Context.TblBulkJobRuns.FirstOrDefaultAsync(x => x.BulkJobId == jobId);

            if (jobRunToDelete == null)
            {
                return new Response
                {
                    Result = "Failed",
                    Message = "Can not find the job in any runs!"
                };
            }

            int? previousRunId = jobRunToDelete.RunId;

            Context.TblBulkJobRuns.Remove(jobRunToDelete);
            await Context.SaveChangesAsync();

            Log.Information($"BulkJobID {jobId} removed from RunID {previousRunId?.ToString() ?? "none"}");

            return new Response
            {
                Result = "Success",
                Message = "Job has been removed from the run Successfully!"
            };
        }
        public Response InsertRun(RunJob run)
        {
            throw new NotImplementedException();
        }

        public async Task<object> BulkUpdateRouteDateAsync(BulkUpdateRouteDateRequest request)
        {
            var results = new List<Response>();
            var successCount = 0;
            var failureCount = 0;

            using var transaction = await Context.Database.BeginTransactionAsync();

            try
            {
                var jobsToUpdate = Context.TblBulkJobs
                    .Where(job => request.JobIds.Contains(job.BulkJobId))
                    .ToList();

                var foundJobIds = jobsToUpdate.Select(j => j.BulkJobId).ToList();
                var notFoundJobIds = request.JobIds.Except(foundJobIds).ToList();

                // Add failure results for jobs not found
                foreach (var notFoundId in notFoundJobIds)
                {
                    results.Add(new Response
                    {
                        Result = "Failed",
                        Message = $"Job with ID {notFoundId} not found"
                    });
                    failureCount++;
                }

                // Update found jobs
                foreach (var job in jobsToUpdate)
                {
                    try
                    {
                        job.BookDate = request.NewDate;
                        Context.Entry(job).State = EntityState.Modified;

                        results.Add(new Response
                        {
                            Result = "Success",
                            Message = $"Job {job.BulkJobId} updated successfully"
                        });
                        successCount++;
                    }
                    catch (Exception jobException)
                    {
                        results.Add(new Response
                        {
                            Result = "Failed",
                            Message = $"Error updating job {job.BulkJobId}: " + (jobException.InnerException?.Message ?? jobException.Message)
                        });
                        failureCount++;
                    }
                }

                // Save all changes in a single transaction
                if (successCount > 0)
                {
                    await Context.SaveChangesAsync();
                    await transaction.CommitAsync();
                }
                else
                {
                    await transaction.RollbackAsync();
                }

                // Log the bulk update operation
                Log.Information($"Bulk route date update completed for run '{request.RunName}': {successCount} successful, {failureCount} failed");

                return new
                {
                    Success = successCount,
                    Failed = failureCount,
                    Details = results,
                    Message = $"Updated {successCount} jobs successfully, {failureCount} failed",
                    RunName = request.RunName,
                    NewDate = request.NewDate.ToString("dd/MM/yyyy")
                };
            }
            catch (Exception e)
            {
                await transaction.RollbackAsync();
                Log.Error(e, $"Bulk route date update failed for run '{request.RunName}'");

                return new
                {
                    Success = 0,
                    Failed = request.JobIds.Count,
                    Details = new List<Response>(),
                    Message = "Bulk update operation failed: " + (e.InnerException?.Message ?? e.Message),
                    RunName = request.RunName,
                    NewDate = request.NewDate.ToString("dd/MM/yyyy")
                };
            }
        }

        public async Task<object> VoidJobsAsync(Requests.VoidJobsRequest request)
        {
            var successCount = 0;
            var failureCount = 0;
            int? voidRunId = null;

            using var transaction = await Context.Database.BeginTransactionAsync();

            try
            {
                var jobsToUpdate = Context.TblBulkJobs
                    .Where(job => request.JobIds.Contains(job.BulkJobId))
                    .ToList();

                var notFoundIds = request.JobIds.Except(jobsToUpdate.Select(j => j.BulkJobId)).ToList();
                failureCount = notFoundIds.Count;

                if (request.IsVoid)
                {
                    // --- VOID: find or create the "Void Jobs" run for this date, move jobs into it ---
                    var runDate = request.RunDate.Date;

                    // Find existing Void Jobs run for this date
                    var voidRun = await Context.TblBulkRuns
                        .FirstOrDefaultAsync(r => r.Name == "Void Jobs" && r.DespatchDateTime.HasValue && r.DespatchDateTime.Value.Date == runDate);

                    if (voidRun == null)
                    {
                        // Create a new Void Jobs run for this date
                        voidRun = new TblBulkRun
                        {
                            Name = "Void Jobs",
                            Mins = 0,
                            Kms = 0,
                            Status = 0,
                            DespatchDateTime = runDate,
                            Created = DateTime.Now,
                            LastModified = DateTime.Now
                        };
                        Context.TblBulkRuns.Add(voidRun);
                        await Context.SaveChangesAsync(); // flush to get the ID
                    }

                    voidRunId = voidRun.Id;

                    foreach (var job in jobsToUpdate)
                    {
                        // Update job status
                        job.Void = true;
                        job.JobStatus = 1000;
                        Context.Entry(job).State = EntityState.Modified;

                        // Move job into the Void Jobs run via tblBulkJobRun
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

                        // Also update BulkRunId on the job itself
                        job.BulkRunId = voidRun.Id;

                        successCount++;
                    }
                }
                else
                {
                    // --- UN-VOID: remove jobs from the Void Jobs run, reset status ---

                    foreach (var job in jobsToUpdate)
                    {
                        job.Void = false;
                        job.JobStatus = 0;
                        job.BulkRunId = null;
                        Context.Entry(job).State = EntityState.Modified;

                        // Remove job from its current run (Void Jobs run)
                        var existingJobRun = await Context.TblBulkJobRuns
                            .FirstOrDefaultAsync(jr => jr.BulkJobId == job.BulkJobId);

                        if (existingJobRun != null)
                        {
                            Context.TblBulkJobRuns.Remove(existingJobRun);
                        }

                        successCount++;
                    }

                    // Clean up: delete the Void Jobs run for this date if it has no more jobs
                    var runDate = request.RunDate.Date;
                    var voidRun = await Context.TblBulkRuns
                        .FirstOrDefaultAsync(r => r.Name == "Void Jobs" && r.DespatchDateTime.HasValue && r.DespatchDateTime.Value.Date == runDate);

                    if (voidRun != null)
                    {
                        var remainingJobCount = Context.TblBulkJobRuns
                            .Count(jr => jr.RunId == voidRun.Id && !request.JobIds.Contains(jr.BulkJobId.Value));

                        if (remainingJobCount == 0)
                        {
                            Context.TblBulkRuns.Remove(voidRun);
                        }
                        else
                        {
                            voidRunId = voidRun.Id;
                        }
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
                Log.Information($"Bulk {action} completed: {successCount} successful, {failureCount} failed. Jobs: {JsonConvert.SerializeObject(jobNumbers)}");

                return new
                {
                    Success = successCount,
                    Failed = failureCount,
                    VoidRunId = voidRunId,
                    Message = $"{(request.IsVoid ? "Voided" : "Un-voided")} {successCount} jobs successfully, {failureCount} failed"
                };
            }
            catch (Exception e)
            {
                await transaction.RollbackAsync();
                Log.Error(e, $"Bulk {(request.IsVoid ? "void" : "un-void")} operation failed");

                return new
                {
                    Success = 0,
                    Failed = request.JobIds.Count,
                    VoidRunId = (int?)null,
                    Message = $"Bulk {(request.IsVoid ? "void" : "un-void")} operation failed: " + (e.InnerException?.Message ?? e.Message)
                };
            }
        }

        public List<int> GetMultiboxChildJobIds(int parentBulkJobId)
        {
            return Context.TblBulkJobs
                .Where(j => j.MultiboxParentId == parentBulkJobId || j.ParentId == parentBulkJobId)
                .Select(j => j.BulkJobId)
                .ToList();
        }
    }
}