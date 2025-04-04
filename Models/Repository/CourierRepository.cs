using Microsoft.EntityFrameworkCore;
using System.Collections;

namespace RunBuilder.Models.Repository
{
    public class CourierRepository(IDbContextFactory<DynamicDespatchDbContext> contextFactory) : BaseRepository(contextFactory)
    {
        public async Task<IEnumerable> GetPotentialCouriersAsync()
        {
            var result = await Context.Procedures.UTL_stpCourier_ActiveAsync();
            return result;
        }
    }
}