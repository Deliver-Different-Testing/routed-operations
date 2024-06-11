using Microsoft.AspNetCore.Mvc;
using RunBuilder.Models;
using RunBuilder.Models.Repository;

namespace RunBuilder.Controllers
{
    public class JobController(JobRepository repository) : Controller
    {
        [HttpGet]
        public async Task<ActionResult> Index(DateTime? datetime, string clientIds, string regionIds, string ourRefs, string speeds)
        {
            return new JsonResult(new
            {
                BulkJobs = await repository.GetBulkJobsAsync(datetime, clientIds, regionIds, ourRefs, speeds),
                MaxJsonLength = int.MaxValue
            });
        }

        // POST: Job
        [HttpPost]
        public async Task<ActionResult> InsertRunJobs([FromBody]IEnumerable<RunJob> runJobs)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = await repository.InsertJobsAsync(runJobs);
                    return Json(new { response = result });
                }
                catch (Exception e)
                {
                    return Json(new { response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message) });
                }
            }
            else
            {
                var errors = string.Join(" | ",
                    ModelState.Values
                        .SelectMany(v => v.Errors)
                        .Select(e => e.ErrorMessage));

                return Json(new { response = "Invalid run data: " + errors });
            }

        }

        
        [HttpGet]
        [ActionName("GetRunSettings")]
        public async Task<ActionResult> GetRunSettings()
        {
            try
            {
                var result = await repository.GetBulkRunSettingsAsync();
                return Json(new{response = result});   
            }
            catch (Exception e)
            {
                return Json(new{response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message)});
            }
        }


        [HttpGet]
        public async Task<ActionResult> RegionList(DateTime runDate)
        {
            var result = await repository.GetRegionListAsync(runDate);
            return Json(result);
        }

        [HttpGet]
        public async Task<ActionResult> SpeedList(DateTime runDate)
        {
            var result = await repository.SpeedListAsync(runDate);
            return Json(result);
        }

        [HttpPost]
        [ActionName("SyncHDJobs")]
        public async Task<ActionResult> SyncHDJobs(DateTime runDate)
        {
            try
            {
                var result = await repository.SyncHDJobs(runDate);
                return Json(new { response = result });
            }
            catch (Exception e)
            {
                return Json(new { response = "Sync EH/HD jobs failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message) });
            }
        }

        [HttpGet]
        public async Task<ActionResult> GetFilter(DateTime runDate)
        {
            var result = await repository.GetFilter(runDate);
            return Json(result);
        }
        
        [HttpGet]
        [ActionName("GetBulkRuns")]
        public async Task<ActionResult> GetBulkRuns(DateTime? datetime, string clientIds, string regionIds, string ourRefs, string speeds)
        {
            try
            {
                var result = await repository.GetBulkRunsAsync(datetime, clientIds, regionIds, ourRefs, speeds);
                return new JsonResult(new {
                    response =  result,
                    MaxJsonLength =  int.MaxValue
                });   
            }
            catch (Exception e)
            {
                return Json(new{response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message)});
            }
        }

        [HttpPost]
        public async Task<ActionResult> InsertOrUpdateRun([FromBody]RunJob run)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = await repository.InsertOrUpdateRunAsync(run);
                    return Json(new{response = result});   
                }
                catch (Exception e)
                {
                    return Json(new{response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message)});
                }
            }
            else
            {
                var errors = string.Join(" | ",
                    ModelState.Values
                        .SelectMany(v => v.Errors)
                        .Select(e => e.ErrorMessage));

                return Json(new{response = "Invalid run data: " + errors}); 
            }
        }

        [HttpPost]
        public async Task<ActionResult> UpdateRun([FromBody]RunJob run)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = await repository.UpdateRun(run);
                    return Json(new { response = result });
                }
                catch (Exception e)
                {
                    return Json(new { response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message) });
                }
            }
            else
            {
                var errors = string.Join(" | ",
                    ModelState.Values
                        .SelectMany(v => v.Errors)
                        .Select(e => e.ErrorMessage));

                return Json(new { response = "Invalid run data: " + errors });
            }
        }
        [HttpPost]
        public async Task<ActionResult> DeleteRun([FromBody]int id)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    await repository.DeleteBulkRunAsync(id);
                    return Json(new{response = "Success"});   
                }
                catch (Exception e)
                {
                    return Json(new{response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message)});
                }
            }
            else
            {
                var errors = string.Join(" | ",
                    ModelState.Values
                        .SelectMany(v => v.Errors)
                        .Select(e => e.ErrorMessage));

                return Json(new{response = "Invalid run data: " + errors}); 
            }
        }

        [HttpPost]
        public ActionResult UpdateJobDetail([FromBody]int jobId, [FromBody]string field, [FromBody]string value)
        {
            if (ModelState.IsValid)
            {
                var selectedJob = repository.GetBulkJobById(jobId);

                if (selectedJob == null)
                {
                    return NotFound();
                }

                try
                {
                    var response = repository.Update(selectedJob, field, value);

                    return Json(response ? new{response = "Success"} : new{response = "Failed"});
                }
                catch (Exception e)
                {
                    return Json(new{response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message)});
                }
            }
            else
            {
                var errors = string.Join(" | ",
                    ModelState.Values
                        .SelectMany(v => v.Errors)
                        .Select(e => e.ErrorMessage));

                return Json(new{response = "Invalid job data: " + errors}); 
            }
        }

        [HttpPost]
        public async Task<ActionResult> UpdateJobToRun([FromBody] int jobId, [FromBody]int? fromRunId, [FromBody]int runId)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = await repository.UpdateBulkJobRun(jobId, fromRunId, runId);
                    return Json(new { response = result });
                }
                catch (Exception e)
                {
                    return Json(new { response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message) });
                }
            }
            else
            {
                var errors = string.Join(" | ",
                    ModelState.Values
                        .SelectMany(v => v.Errors)
                        .Select(e => e.ErrorMessage));

                return Json(new { response = "Invalid job data: " + errors });
            }
        }

        [HttpPost]
        public async Task<ActionResult> DeleteBulkJobRun([FromBody]int jobId)
        {
            try
            {
                var result = await repository.DeleteBulkJobRun(jobId);
                return Json(new { response = result });
            }
            catch (Exception e)
            {
                return Json(new { response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message) });
            }
        }


        [HttpPost]
        public ActionResult UpdateGps([FromBody]int jobId, [FromBody]string address, [FromBody] string lat, [FromBody] string lng, [FromBody] string postCode)
        {
            if (ModelState.IsValid)
            {
                var selectedJob = repository.GetBulkJobById(jobId);

                if (selectedJob == null)
                {
                    return NotFound();
                }

                if (address == "ToAddress")
                {
                    selectedJob.DeliveryLatitude = lat;
                    selectedJob.DeliveryLongitude = lng;
                    selectedJob.ToPostCode = string.IsNullOrEmpty(postCode) ? 0 : int.Parse(postCode);
                }
                else
                {
                    selectedJob.PickUpLatitude = lat;
                    selectedJob.PickUpLongitude = lng;
                    selectedJob.FromPostCode =  string.IsNullOrEmpty(postCode) ? 0: int.Parse(postCode);
                }

                try
                {
                    var response = repository.UpdateBulkJob(selectedJob);

                    if (response)
                    {
                        return Json(new{response = "Success"});    
                    }
                    else
                    {
                        return Json(new{response = "Failed"});      
                    }
                }
                catch (Exception e)
                {
                    return Json(new{response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message)});
                }
               
            }
            else
            {
                var errors = string.Join(" | ",
                    ModelState.Values
                        .SelectMany(v => v.Errors)
                        .Select(e => e.ErrorMessage));

                return Json(new{response = "Invalid run data: " + errors}); 
            }
        }
    }
}