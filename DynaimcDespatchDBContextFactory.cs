using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RunBuilder.Models;
using Serilog;

namespace RunBuilder
{
    public class DynamicDespatchDbContextFactory(
        IOptions<DbContextOptions<DespatchContext>> options,
        IConnectionStringManager connectionStringManager,
        IHttpContextAccessor contextAccessor)
        : IDbContextFactory<DynamicDespatchDbContext>
    {
        private readonly DbContextOptions<DespatchContext> _options = options.Value;

        public  DynamicDespatchDbContext CreateDbContext()
        {
            var tenantId = contextAccessor.HttpContext?.User.Claims.FirstOrDefault(x => x.Type == "CurrentTenantID")?.Value;
            var connectionString = connectionStringManager.GetConnectionStringAsync($"{tenantId}-RunBuilder-Connection").GetAwaiter().GetResult();
        
            if (string.IsNullOrEmpty(connectionString))
            {
                Log.Error("Connection string is not set");
                throw new InvalidOperationException("Connection string is not set");
            }

            var optionsBuilder = new DbContextOptionsBuilder<DespatchContext>(_options);
            optionsBuilder.UseSqlServer(connectionString);

            Log.Information("Creating DynamicDespatchDbContext with connection string");
            return new DynamicDespatchDbContext(optionsBuilder.Options);
        }
    }
}
