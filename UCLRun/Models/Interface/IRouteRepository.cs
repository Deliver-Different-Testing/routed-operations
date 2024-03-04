using System.Collections.Generic;
using System.Threading.Tasks;

namespace UCLRun.Models.Interface
{
    public interface IRouteRepository
    {
        Task<RouteSavvyResponse> FetchBulkRouteAsync(List<SavvyLocation> waypoints);
    }
}