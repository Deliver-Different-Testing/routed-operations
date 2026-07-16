using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using RoutedOperations.Core.Domain;
using Serilog;

namespace RoutedOperations.Infrastructure;

/// <summary>
/// Builds the Despatch EF model at startup so the first user request after a
/// pod starts does not pay the one-time model-build cost. Non-fatal.
/// </summary>
public class EfModelWarmupService(IOptions<DbContextOptions<DespatchContext>> baseOptions) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            var options = new DbContextOptionsBuilder<DespatchContext>(baseOptions.Value)
                .UseSqlServer("Server=warmup;Database=warmup;Encrypt=False;TrustServerCertificate=True;")
                .Options;

            using var ctx = new DynamicDespatchDbContext(options);
            _ = ctx.Model;

            Log.Information("EF model warmup complete for DynamicDespatchDbContext.");
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "EF model warmup failed (non-fatal).");
        }
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
