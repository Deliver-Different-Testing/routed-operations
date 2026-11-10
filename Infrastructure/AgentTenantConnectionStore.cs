using DeliverDifferent.AgentAccess;
using RoutedOperations.Core.Application.Utilities;

namespace RoutedOperations.Infrastructure;

/// <summary>
/// An agent (MCP) request carries no cookie Connection claim, so the AgentAccess package seeds the tenant's
/// connection from Hub into this app's own cache key, the one <see cref="DynamicDespatchDbContextFactory"/> reads.
/// </summary>
public sealed class AgentTenantConnectionStore(IConnectionStringManager connections) : IAgentTenantConnectionStore
{
    public async Task<bool> HasAsync(int tenantId, CancellationToken cancellationToken = default) =>
        !string.IsNullOrEmpty(await connections.GetConnectionStringAsync(TenantConnectionCache.Key(tenantId.ToString())));

    public Task SetAsync(int tenantId, string connectionString, CancellationToken cancellationToken = default) =>
        connections.SetConnectionStringAsync(TenantConnectionCache.Key(tenantId.ToString()), connectionString);
}
