using System.Threading.Tasks;

namespace RoutedOperations.Infrastructure;

public interface IConnectionStringManager
{
    Task SetConnectionStringAsync(string tenantAppCacheKey, string connectionString);
    Task<string?> GetConnectionStringAsync(string tenantAppCacheKey);
}
