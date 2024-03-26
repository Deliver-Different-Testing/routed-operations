using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;


namespace RunBuilder.Models.Repository
{
    public class JobRepository 
    {
        private readonly DespatchContext _context;
        
        public JobRepository(DespatchContext context)
        {
            _context =context;
        }

        public TblBulkJob? GetBulkJobByID(int jobID)
        {
            return _context.TblBulkJobs.Find(jobID);
        }

        

        public async Task<List<UTL_stpJob_tblBulkJobResult>> GetBulkJobsAsync(DateTime? dateTime, string clientIds)
        {

            var jobsResult = new List<UTL_stpJob_tblBulkJobResult>();

            if (!string.IsNullOrEmpty(clientIds))
            {

                var ids = clientIds.Split(',');

                foreach (var id in ids)
                {
                    jobsResult.AddRange(await _context.Procedures.UTL_stpJob_tblBulkJobAsync(dateTime, Convert.ToInt32(id)));
                }
            }
            else
            {
                jobsResult = await _context.Procedures.UTL_stpJob_tblBulkJobAsync(dateTime, null);
            }

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
                        _context.Entry(bulkJob).Property(propertyName).CurrentValue = Convert.ToDecimal(value);
                        break;
                    case "BookDate":
                    case "BookTime":
                        _context.Entry(bulkJob).Property(propertyName).CurrentValue = Convert.ToDateTime(value);
                        break;
                    default:
                        _context.Entry(bulkJob).Property(propertyName).CurrentValue = value;
                        break;
                }

                _context.Entry(bulkJob).State = EntityState.Modified;
                _context.SaveChanges();
                result = true;
            }
            catch (Exception e)
            {
                result = false;
                throw e;
            }

            return result;
        }

        public bool UpdateBulkJob(TblBulkJob bulkJob)
        {
            var result = false;
            try
            {
                _context.Entry(bulkJob).State = EntityState.Modified;
                _context.SaveChanges();
                result = true;
            }
            catch (Exception e)
            {
                throw e;
                //result = false;
            }

            return result;
        }

        public async Task<List<Response>> InsertJobsAsync(IEnumerable<RunJob> runJobs)
        {
            try
            {
                var result = new List<Response>();
                foreach (var run in runJobs)
                {
                    var runName = run.Name;

                    float courierPercentage = 0;
                    if (run.CourierPercent != null)
                    {
                        courierPercentage =  float.Parse(run.CourierPercent.TrimEnd( new char[] { '%', ' ' } ) ) / 100;
                    }
                    
                    var courierID = run.Courier?.courierID;
                    var runOrder = 1;
                    foreach (var job in run.Jobs)
                    {
                        result.Add( 
                            await InsertJobAsync(job.BulkJobID, courierID, runName, runOrder++, courierPercentage)
                        );
                    }
                }
                return result;
            }
            catch (Exception e)
            {
                throw e;
            }
            
        }

        public async Task<Response> InsertJobAsync(int jobID, int? courierID, string runName, int runOrder, float courierPercentage )
        {
            try
            {
                await _context.Procedures.UTL_stpJob_InsertFromRunBuilderAsync(jobID, courierID, runName, runOrder, courierPercentage, null );
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
            var settings = await _context.Procedures.UTL_stpJob_tblBulkRunSettingsAsync();

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

        public async Task<List<UTL_stpJob_tblBulkRunResult>> GetBulkRunsAsync(DateTime? datetime, string clientIds)
        {
            var bulkRunResult = new List<UTL_stpJob_tblBulkRunResult>();

            if (!string.IsNullOrEmpty(clientIds))
            {

                var ids = clientIds.Split(',');

                foreach (var id in ids)
                {
                    bulkRunResult.AddRange(await _context.Procedures.UTL_stpJob_tblBulkRunAsync(datetime, Convert.ToInt32(id)));
                }
            }
            else
            {
                bulkRunResult = await _context.Procedures.UTL_stpJob_tblBulkRunAsync(datetime, null);
            }

            return bulkRunResult;
        }

        public async Task DeleteBulkRunAsync(int ID)
        {
            await _context.Procedures.UTL_stpJob_tblBulkRun_DeleteAsync(ID);
        }

        public async Task<Response> InsertOrUpdateRunAsync(RunJob run)
        {
            try
            {
                float courierPercentage = 0;
                if (run.CourierPercent != null && run.CourierPercent != "NaN%")
                {
                    courierPercentage =  float.Parse(run.CourierPercent.TrimEnd( new char[] { '%', ' ' } ) ) / 100;
                }

                var googleRouteResponse = JsonConvert.SerializeObject(run.GoogleRouteResponse);

                // Insert or update the run detail
                var runResult = await _context.Procedures.UTL_stpJob_tblBulkRun_InsertOrUpdateAsync(run.ID, run.Name, run.Mins, run.Kms, run.Courier?.courierID,
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
                    await _context.Procedures.UTL_stpJob_tblBulkJobRun_InsertOrUpdateAsync(runResult.First().RunID, job.BulkJobID, job.BuilderIndex);
                }

                return new Response
                {
                    Result = "Success",

                    Message = runResult.First().RunID.ToString()
                };

            }   
            catch (Exception e)
            {
                throw e;

            }
        }
    }
}