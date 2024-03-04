using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Web;
using System.Web.Mvc;
using UCLRun.Models;
using UCLRun.Models.Interface;
using UCLRun.Models.Repository;

namespace UCLRun.Controllers
{
    public class RouteController : Controller
    {
        private IRouteRepository _Repo = new RouteRepository();
        private  GoogleDirectionRepository _googleRepo = new GoogleDirectionRepository();

        public ActionResult Index()
        {
            //var result = _Repo.FetchBulkRouteAsync(waypoints);
            //return Json(new {routes = result}, JsonRequestBehavior.AllowGet);

            //return Json( new {routes =  await _Repo.FetchBulkRouteAsync(waypoints)}, JsonRequestBehavior.AllowGet);
            return null;
        }

        // GET: Route
        [HttpPost]
        public async Task<ActionResult> Index(List<SavvyLocation> waypoints)
        {
            try
            {
                RouteSavvyResponse savvyResponse = await _Repo.FetchBulkRouteAsync(waypoints);
                //var result = _googleRepo.GetDirectionsResponseFromRouteSavvy(savvyResponse);
                var result = _googleRepo.GetOrderedWaypoints(savvyResponse);
                return Json(new { routes = result });
            }
            catch (Exception e)
            {
                Console.WriteLine(e);
                throw;
            }        
        }

        // GET: Route
        [HttpPost]
        //[ActionName("RouteWithName")]
        public async Task<ActionResult> RouteWithName(List<SavvyLocation> waypoints)
        {
            try
            {
                RouteSavvyResponse savvyResponse = await _Repo.FetchBulkRouteAsync(waypoints);
                //var result = _googleRepo.GetDirectionsResponseFromRouteSavvy(savvyResponse);
                var result = _googleRepo.GetOrderedWaypointsWithName(savvyResponse);
                return Json(new { routes = result });
            }
            catch (Exception e)
            {
                Console.WriteLine(e);
                throw;
            }        
        }


    }
}