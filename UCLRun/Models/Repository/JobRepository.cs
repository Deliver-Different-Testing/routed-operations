using System;
using System.Collections;
using System.Collections.Generic;
using System.EnterpriseServices;
using System.Linq;
using System.Web;
using Newtonsoft.Json;
using UCLRun.Models.Interface;

namespace UCLRun.Models.Repository
{
    public class JobRepository : IJobRepository
    {
        DespatchContext context = new DespatchContext();
        //public void DeleteBulkJob(int id)
        //{
        //    vw_tblBulkJob bulkJob = context.vw_tblBulkJob.Find(id);
        //    context.vw_tblBulkJob.Remove(bulkJob);
        //    context.SaveChanges();
        //}


        public tblBulkJob GetBulkJobByID(int jobID)
        {
            return context.tblBulkJobs.Find(jobID);
        }

        //public vw_tblBulkJob GetBulkJobById(int id)
        //{
        //    var result = (from r in context.vw_tblBulkJob
        //        where r.BulkJobID == id
        //        select r).FirstOrDefault();
        //    return result;
        //}

        public List<BulkJob> GetBulkJobs(DateTime? dateTime, string clientIds)
        {

            var jobsResult = new List<BulkJob>();

            if (!String.IsNullOrEmpty(clientIds))
            {

                var ids = clientIds.Split(',');

                foreach (var id in ids)
                {
                    jobsResult.AddRange(context.GetBulkJobs(dateTime, Convert.ToInt32(id)).ToList());
                }
            }
            else
            {
                jobsResult = context.GetBulkJobs(dateTime, null).ToList();
            }

            return jobsResult;
        }

        //public void InsertBulkJob(vw_tblBulkJob bulkJob)
        //{
        //    context.vw_tblBulkJob.Add(bulkJob);
        //    context.SaveChanges();
        //}

        
        public bool Update(tblBulkJob bulkJob, string propertyName, string value)
        {
            var result = false;
            try
            {
                if (propertyName == "Amount")
                {
                    context.Entry(bulkJob).Property(propertyName).CurrentValue = Convert.ToDecimal(value);  
                }
                else if (propertyName == "BookDate" || propertyName == "BookTime")
                {
                    context.Entry(bulkJob).Property(propertyName).CurrentValue = Convert.ToDateTime(value);
                }
                else
                {
                    context.Entry(bulkJob).Property(propertyName).CurrentValue = value;  
                }
               
                context.Entry(bulkJob).State = System.Data.Entity.EntityState.Modified;
                context.SaveChanges();
                result = true;
            }
            catch (Exception e)
            {
                result = false;
                throw e;
            }

            return result;
        }

        public bool UpdateBulkJob(tblBulkJob bulkJob)
        {
            var result = false;
            try
            {
                context.Entry(bulkJob).State = System.Data.Entity.EntityState.Modified;
                context.SaveChanges();
                result = true;
            }
            catch (Exception e)
            {
                throw e;
                //result = false;
            }

            return result;
        }

        public List<Response> InsertJobs(IEnumerable<RunJob> runJobs)
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
                 
                    //var courierID = run.Courier?.courierID ?? 0;
                    var courierID = run.Courier?.courierID;
                    int runOrder = 1;
                    foreach (var job in run.Jobs)
                    {
                        result.Add( 
                            InsertJob(job.BulkJobID, courierID, runName, runOrder++, courierPercentage)
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

        public Response InsertJob(int jobID, int? courierID, string runName, int runOrder, float courierPercentage )
        {
            try
            {
                context.InsertJob(jobID, courierID, runName, runOrder, courierPercentage);
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


        public Object GetBulkRunSettings()
        {
            var settings = context.GetBulkRunSettings().ToList();

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

        public List<BulkRun> GetBulkRuns(DateTime? datetime, string clientIds)
        {
            var bulkRunResult = new List<BulkRun>();

            if (!String.IsNullOrEmpty(clientIds))
            {

                var ids = clientIds.Split(',');

                foreach (var id in ids)
                {
                    bulkRunResult.AddRange(context.GetBulkRun(datetime, Convert.ToInt32(id)).ToList());
                }
            }
            else
            {
                bulkRunResult = context.GetBulkRun(datetime, null).ToList();
            }

            return bulkRunResult;
        }

        public void DeleteBulkRun(int ID)
        {
            context.DeleteBulkRun(ID);
        }

        public Response InsertOrUpdateRun(RunJob run)
        {
            try
            {
                float courierPercentage = 0;
                if (run.CourierPercent != null && run.CourierPercent != "NaN%")
                {
                    courierPercentage =  float.Parse(run.CourierPercent.TrimEnd( new char[] { '%', ' ' } ) ) / 100;
                }

                string googleRouteResponse = JsonConvert.SerializeObject(run.GoogleRouteResponse);

                // Insert or update the run detail
                var runResult = context.InsertOrUpdateRun(run.ID, run.Name, run.Mins, run.Kms, run.Courier?.courierID,
                run.Status, run.Revenue, run.Payout, courierPercentage, googleRouteResponse).FirstOrDefault();

                if (!runResult.HasValue)
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
                    context.InsertOrUpdateJobRun(runResult.Value, job.BulkJobID, job.BuilderIndex);
                }

                return new Response
                {
                    Result = "Success",
                    // Store RunID into message
                    Message = runResult.Value.ToString()
                };

            }   
            catch (Exception e)
            {
                throw e;
                //return new Response
                //{
                //    Result = "Failed",
                //    Message = (e.InnerException == null ? e.Message : e.InnerException.Message)
                //};
            }
        }
    }
}