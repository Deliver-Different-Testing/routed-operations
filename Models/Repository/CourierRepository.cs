using System.Collections;

namespace RunBuilder.Models.Repository
{
    public class CourierRepository(DespatchContext context)
    {
        public async Task<IEnumerable> GetPotentialCouriersAsync()
        {
            var result = await context.Procedures.UTL_stpCourier_ActiveAsync();
            return result;
        }
    }
}