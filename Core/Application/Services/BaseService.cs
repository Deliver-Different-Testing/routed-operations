using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services;

/// <summary>
/// Lazy-injects the per-request DynamicDespatchDbContext. Ported from the
/// Configurator BaseService so the same pattern applies here.
/// </summary>
public class BaseService(IDbContextFactory<DynamicDespatchDbContext> contextFactory) : IDisposable
{
    private DynamicDespatchDbContext? _context;
    protected DynamicDespatchDbContext Context => _context ??= contextFactory.CreateDbContext();

    public void Dispose()
    {
        _context?.Dispose();
        GC.SuppressFinalize(this);
    }
}
