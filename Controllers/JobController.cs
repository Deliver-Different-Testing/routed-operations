using Microsoft.AspNetCore.Mvc;
using RunBuilder.Models;
using RunBuilder.Models.Repository;

namespace RunBuilder.Controllers
{
    public class JobController(JobRepository repository) : Controller
    {
        [HttpGet]
        public async Task<ActionResult> Index(DateTime? datetime, string clientIds)
        {
            return new JsonResult(new
            {
                BulkJobs = await repository.GetBulkJobsAsync(datetime, clientIds),
                MaxJsonLength = Int32.MaxValue
            });
        }

        // POST: Job
        [HttpPost]
        public async Task<ActionResult> InsertRunJobs(IEnumerable<RunJob> runJobs)
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
            //return Json(new{response = "Testing done!"});
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
        [ActionName("GetBulkRuns")]
        public async Task<ActionResult> GetBulkRuns(DateTime? datetime, string clientIds)
        {
            try
            {
                var result = await repository.GetBulkRunsAsync(datetime, clientIds);
                return new JsonResult(new {
                    response =  result,
                    MaxJsonLength =  Int32.MaxValue
                });   
            }
            catch (Exception e)
            {
                return Json(new{response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message)});
            }
        }

        [HttpPost]
        public async Task<ActionResult> InsertOrUpdateRunAsync(RunJob run)
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
        public async Task<ActionResult> DeleteRun(int id)
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
        public ActionResult UpdateJobDetail(int jobId, string field, string value)
        {
            if (ModelState.IsValid)
            {
                var selectedJob = repository.GetBulkJobByID(jobId);

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
        public ActionResult UpdateGps(int jobId, string address, string lat, string lng, string postCode)
        {
            if (ModelState.IsValid)
            {
                var selectedJob = repository.GetBulkJobByID(jobId);

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