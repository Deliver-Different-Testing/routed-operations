using Microsoft.AspNetCore.Mvc;
using RunBuilder.Models;
using RunBuilder.Models.Repository;
using RunBuilder.Models.Requests;

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
        public async Task<ActionResult> InsertRunJobs([FromBody] IEnumerable<RunJob> runJobs)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = await repository.InsertJobsAsync(runJobs);
                    if (result == null)
                    {
                        return Json(new { response = new[] { new { Result = "Failed", Message = "No jobs were inserted from the InsertJobsAsync" } } });
                    }

                    return Json(new { response = result });
                }
                catch (Exception e)
                {
                    var errorMessage = e.InnerException == null ? e.Message : e.InnerException.Message;
                    return Json(new { response = new[] { new {  Result = "Failed", Message = errorMessage}} });
                }
            }
            else
            {
                var errors = string.Join(" | ",
                    ModelState.Values
                        .SelectMany(v => v.Errors)
                        .Select(e => e.ErrorMessage));

                return Json(new { response = new[] {new {Result = "Failed",Message = "Invalid run data: " + errors}}});
            }

        }

        [HttpGet]
        [ActionName("GetRunSettings")]
        public async Task<ActionResult> GetRunSettings()
        {
            try
            {
                var result = await repository.GetBulkRunSettingsAsync();
                return Json(new { response = result });
            }
            catch (Exception e)
            {
                return Json(new { response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message) });
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

        [HttpGet]
        public async Task<ActionResult> AllSpeeds()
        {
            var result = await repository.AllSpeedsAsync();
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
                return new JsonResult(new
                {
                    response = result,
                    MaxJsonLength = int.MaxValue
                });
            }
            catch (Exception e)
            {
                return Json(new { response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message) });
            }
        }

        [HttpPost]
        public async Task<ActionResult> InsertOrUpdateRun([FromBody] RunJob run)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = await repository.InsertOrUpdateRunAsync(run);
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
        public async Task<ActionResult> UpdateRun([FromBody] RunJob run)
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
        public async Task<ActionResult> DeleteRun([FromBody] int id)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    await repository.DeleteBulkRunAsync(id);
                    return Json(new { response = "Success" });
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
        public ActionResult UpdateJobDetail([FromBody] UpdateJobDetailRequest request)
        {
            if (ModelState.IsValid)
            {
                var selectedJob = repository.GetBulkJobById(request.JobId);

                if (selectedJob == null)
                {
                    return NotFound();
                }

                try
                {
                    var response = repository.Update(selectedJob, request.Field, request.Value);
                    return Json(response ? new { response = "Success" } : new { response = "Failed" });
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
        public async Task<ActionResult> UpdateJobToRun([FromBody] UpdateJobToRunRequest request)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = await repository.UpdateBulkJobRun(request.JobId, request.FromRunId, request.RunId);
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
        public async Task<ActionResult> DeleteBulkJobRun([FromBody] int jobId)
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
        public ActionResult UpdateGps([FromBody] UpdateGpsRequest request)
        {
            if (ModelState.IsValid)
            {
                var selectedJob = repository.GetBulkJobById(request.JobId);

                if (selectedJob == null)
                {
                    return NotFound();
                }

                if (request.Address == "ToAddress")
                {
                    selectedJob.DeliveryLatitude = request.Lat;
                    selectedJob.DeliveryLongitude = request.Lng;
                    selectedJob.ToPostCode = string.IsNullOrEmpty(request.PostCode) ? 0 : int.Parse(request.PostCode);
                }
                else
                {
                    selectedJob.PickUpLatitude = request.Lat;
                    selectedJob.PickUpLongitude = request.Lng;
                    selectedJob.FromPostCode = string.IsNullOrEmpty(request.PostCode) ? 0 : int.Parse(request.PostCode);
                }

                try
                {
                    var response = repository.UpdateBulkJob(selectedJob);

                    if (response)
                    {
                        return Json(new { response = "Success" });
                    }
                    else
                    {
                        return Json(new { response = "Failed" });
                    }
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
        public async Task<ActionResult> BulkUpdateRouteDate([FromBody] BulkUpdateRouteDateRequest request)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = await repository.BulkUpdateRouteDateAsync(request);
                    return Json(new { response = result });
                }
                catch (Exception e)
                {
                    return Json(new
                    {
                        response = new
                        {
                            Success = 0,
                            Failed = request.JobIds?.Count ?? 0,
                            Message = "Bulk update failed: " + (e.InnerException?.Message ?? e.Message)
                        }
                    });
                }
            }
            else
            {
                var errors = string.Join(" | ",
                    ModelState.Values
                        .SelectMany(v => v.Errors)
                        .Select(e => e.ErrorMessage));

                return Json(new
                {
                    response = new
                    {
                        Success = 0,
                        Failed = request.JobIds?.Count ?? 0,
                        Message = "Invalid request data: " + errors
                    }
                });
            }
        }

        [HttpPost]
        public async Task<ActionResult> VoidJobs([FromBody] VoidJobsRequest request)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = await repository.VoidJobsAsync(request);
                    return Json(new { response = result });
                }
                catch (Exception e)
                {
                    return Json(new
                    {
                        response = new
                        {
                            Success = 0,
                            Failed = request.JobIds?.Count ?? 0,
                            Message = $"Bulk {(request.IsVoid ? "void" : "un-void")} failed: " + (e.InnerException?.Message ?? e.Message)
                        }
                    });
                }
            }
            else
            {
                var errors = string.Join(" | ",
                    ModelState.Values
                        .SelectMany(v => v.Errors)
                        .Select(e => e.ErrorMessage));

                return Json(new
                {
                    response = new
                    {
                        Success = 0,
                        Failed = request.JobIds?.Count ?? 0,
                        Message = "Invalid request data: " + errors
                    }
                });
            }
        }

        [HttpGet]
        public ActionResult GetMultiboxChildren(int parentJobId)
        {
            try
            {
                var childIds = repository.GetMultiboxChildJobIds(parentJobId);
                return Json(new { response = childIds });
            }
            catch (Exception e)
            {
                return Json(new { response = new List<int>(), error = e.InnerException?.Message ?? e.Message });
            }
        }
    }
}