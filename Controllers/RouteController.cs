using Microsoft.AspNetCore.Mvc;
using RunBuilder.Models;
using RunBuilder.Models.Repository;

namespace RunBuilder.Controllers
{
    public class RouteController : Controller
    {
        private readonly RouteRepository _repo;
        private readonly GoogleDirectionRepository _googleRepo;

        public RouteController(RouteRepository repository, GoogleDirectionRepository googleRepository)
        {
            _repo = repository;
            _googleRepo = googleRepository;
        }

        public ActionResult Index()
        {
            
            return null;
        }

        // GET: Route
        [HttpPost]
        public async Task<ActionResult> Index(List<SavvyLocation> waypoints)
        {
            try
            {
                RouteSavvyResponse savvyResponse = await _repo.FetchBulkRouteAsync(waypoints);
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
                RouteSavvyResponse savvyResponse = await _repo.FetchBulkRouteAsync(waypoints);
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