using Microsoft.AspNetCore.Mvc;
using RunBuilder.Models.Repository;

namespace RunBuilder.Controllers
{
    public class CourierController(CourierRepository repository) : Controller
    {
        // GET: Courier
        public async Task<ActionResult> Index()
        {
            var potentialCouriers = await repository.GetPotentialCouriersAsync();
            return Json(new {PotentialCouriers = potentialCouriers});
        }
    }
}