using Microsoft.EntityFrameworkCore;

namespace RoutedOperations.Core.Domain;

/// <summary>
/// Runtime DbContext used by every request. Extends DespatchContext with any
/// hand-authored entity configuration that shouldn't live in the Power Tools
/// scaffold. Stage 1 has none - the base context is sufficient.
/// </summary>
public class DynamicDespatchDbContext(DbContextOptions options) : DespatchContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
    }
}
