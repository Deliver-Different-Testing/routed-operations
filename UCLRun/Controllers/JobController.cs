using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using System.Web.Mvc;
using UCLRun.Models;
using UCLRun.Models.Interface;
using UCLRun.Models.Repository;

namespace UCLRun.Controllers
{
    public class JobController : Controller
    {

        private IJobRepository _Repo = new JobRepository();
        //private IJobRepository _jobRepository;

        //public JobController()
        //{
        //    _jobRepository = new JobRepository();
        //}
        // GET: Job
        //[HttpGet]
        //public ActionResult Index()
        //{
        //    return Json( new {BulkJobs = _Repo.GetBulkJobs()}, JsonRequestBehavior.AllowGet);
        //}

        [HttpGet]
        public ActionResult Index(DateTime? datetime, string clientIds)
        {
            return new JsonResult()
            {
                Data = new {BulkJobs = _Repo.GetBulkJobs(datetime, clientIds)}, 
                JsonRequestBehavior = JsonRequestBehavior.AllowGet,
                MaxJsonLength = Int32.MaxValue
            };
        }

        // POST: Job
        [HttpPost]
        public ActionResult InsertRunJobs(IEnumerable<RunJob> runJobs)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = _Repo.InsertJobs(runJobs);
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
        public ActionResult GetRunSettings()
        {
            try
            {
                var result = _Repo.GetBulkRunSettings();
                return Json(new{response = result}, JsonRequestBehavior.AllowGet);   
            }
            catch (Exception e)
            {
                return Json(new{response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message)});
            }
        }

        [HttpGet]
        [ActionName("GetBulkRuns")]
        public ActionResult GetBulkRuns(DateTime? datetime, string clientIds)
        {
            try
            {
                var result = _Repo.GetBulkRuns(datetime, clientIds);
                return new JsonResult() {
                    Data = new{response = result},
                    JsonRequestBehavior = JsonRequestBehavior.AllowGet,
                    MaxJsonLength =  Int32.MaxValue
                };   
            }
            catch (Exception e)
            {
                return Json(new{response = "Failed: " + (e.InnerException == null ? e.Message : e.InnerException.Message)});
            }
        }

        [HttpPost]
        public ActionResult InsertOrUpdateRun(RunJob run)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    var result = _Repo.InsertOrUpdateRun(run);
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
        public ActionResult DeleteRun(int ID)
        {
            if (ModelState.IsValid)
            {
                try
                {
                    _Repo.DeleteBulkRun(ID);
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
        public ActionResult UpdateJobDetail(int jobID, string field, string value)
        {
            if (ModelState.IsValid)
            {
                var selectedJob = _Repo.GetBulkJobByID(jobID);

                if (selectedJob == null)
                {
                    return HttpNotFound();
                }

                try
                {
                    var response = _Repo.Update(selectedJob, field, value);

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

                return Json(new{response = "Invalid job data: " + errors}); 
            }
        }

        [HttpPost]
        public ActionResult UpdateGPS(int jobID, string address, string lat, string lng, string postCode)
        {
            if (ModelState.IsValid)
            {
                var selectedJob = _Repo.GetBulkJobByID(jobID);

                if (selectedJob == null)
                {
                    return HttpNotFound();
                }

                if (address == "ToAddress")
                {
                    selectedJob.DeliveryLatitude = lat;
                    selectedJob.DeliveryLongitude = lng;
                    selectedJob.ToPostCode =  String.IsNullOrEmpty(postCode) ? 0: int.Parse(postCode);
                }
                else
                {
                    selectedJob.PickUpLatitude = lat;
                    selectedJob.PickUpLongitude = lng;
                    selectedJob.FromPostCode =  String.IsNullOrEmpty(postCode) ? 0: int.Parse(postCode);
                }

                try
                {
                    var response = _Repo.UpdateBulkJob(selectedJob);

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