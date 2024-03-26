using System.Collections;

namespace RunBuilder.Models.Repository
{
    public class CourierRepository 
    {
        private readonly DespatchContext _context;

        public CourierRepository(DespatchContext context)
        {
            _context = context;
        }
        public async Task<IEnumerable> GetPotentialCouriersAsync()
        {
            var result = await _context.Procedures.UTL_stpCourier_ActiveAsync();
            return result;
        }
    }
}