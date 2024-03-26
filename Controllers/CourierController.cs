using Microsoft.AspNetCore.Mvc;
using RunBuilder.Models.Repository;

namespace RunBuilder.Controllers
{
    public class CourierController : Controller
    {
        private readonly CourierRepository _repo;

        public CourierController(CourierRepository repository)
        {
            _repo = repository;
        }
        // GET: Courier
        public async Task<ActionResult> Index()
        {
            var potentialCouriers = await _repo.GetPotentialCouriersAsync();
            return Json(new {PotentialCouriers = potentialCouriers});
        }
    }
}