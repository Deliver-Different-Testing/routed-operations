using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using System.Web.Mvc;
using Microsoft.Ajax.Utilities;
using UCLRun.Models.Interface;
using UCLRun.Models.Repository;

namespace UCLRun.Controllers
{
    public class CourierController : Controller
    {
        private ICourierRepository _repo = new CourierRepository();
        // GET: Courier
        public ActionResult Index()
        {
            var potentialCouriers = _repo.GetPotentialCouriers();
            return Json(new {PotentialCouriers = potentialCouriers}, JsonRequestBehavior.AllowGet);
        }
    }
}