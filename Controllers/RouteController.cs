using Microsoft.AspNetCore.Mvc;
using RunBuilder.Models;
using RunBuilder.Models.Repository;
using Serilog;

namespace RunBuilder.Controllers
{
    public class RouteController(RouteRepository repository, GoogleDirectionRepository googleRepository)
        : Controller
    {
        public ActionResult Index()
        {
            
            return null;
        }

        // GET: Route
        [HttpPost]
        public async Task<ActionResult> Index([FromBody] List<SavvyLocation> waypoints)
        {
            try
            {
                RouteSavvyResponse savvyResponse = await repository.FetchBulkRouteAsync(waypoints);
                //var result = _googleRepo.GetDirectionsResponseFromRouteSavvy(savvyResponse);
                var result = googleRepository.GetOrderedWaypoints(savvyResponse);
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
        public async Task<ActionResult> RouteWithName([FromBody] List<SavvyLocation> waypoints)
        {
            try
            {
                RouteSavvyResponse savvyResponse = await repository.FetchBulkRouteAsync(waypoints);
                //var result = _googleRepo.GetDirectionsResponseFromRouteSavvy(savvyResponse);
                var result = googleRepository.GetOrderedWaypointsWithName(savvyResponse);
                return Json(new { routes = result });
            }
            catch (Exception e)
            {
                Console.WriteLine(e);
                throw;
            }        
        }

        [HttpPost]
        [ActionName("GetHereMapSequence")]
        public async Task<ActionResult> GetHereMapSequence([FromBody]HereMapSequenceRequest requestData)
        {
            try
            {
                Log.Debug($"Start {nameof(GetHereMapSequence)}: requestData: {requestData}");
                var result = await repository.GetHereMapSequenceAsync(requestData);

                return Json(result);
            }
            catch (Exception e)
            {
                Log.Error("GetHereMapSequence Error:", e);
                throw;
            }
        }
    }
}