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
            var jobRunToUpdate = new TblBulkJobRun { BulkJobId = jobId, RunId = runId };
            if (fromRunId.HasValue)
            {
                jobRunToUpdate = await Context.TblBulkJobRuns.FirstOrDefaultAsync(x => x.BulkJobId == jobId && x.RunId == fromRunId.Value);

                if (jobRunToUpdate == null)
                {
                    return new Response
                    {
                        Result = "Failed",
                        Message = "Can not find the run to update!"
                    };
                }

                jobRunToUpdate.RunId = runId;
                await Context.SaveChangesAsync();
            }
            else
            {
                // Insert only when the bulk job is not in the tblBulkJobRun table
                var jobRunToInsert = await Context.TblBulkJobRuns.FirstOrDefaultAsync(x => x.BulkJobId == jobId);
                if (jobRunToInsert == null)
                {
                    Context.TblBulkJobRuns.Add(jobRunToUpdate);
                    await Context.SaveChangesAsync();
                }
            }

            return new Response
            {
                Result = "Success",
                // Store RunID into message
                Message = jobRunToUpdate.BulkJobId.ToString()
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

            Context.Entry(jobRunToDelete).State = EntityState.Modified;
            await Context.SaveChangesAsync();

            return new Response
            {
                Result = "Success",
                // Store RunID into message
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
    }
}