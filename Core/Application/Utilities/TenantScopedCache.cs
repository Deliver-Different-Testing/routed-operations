using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;

namespace RoutedOperations.Core.Application.Utilities;

/// <summary>
/// Thin wrapper over <see cref="IMemoryCache"/> that prefixes every cache key
/// with the current tenant id from the request's <c>CurrentTenantID</c> claim.
/// Without this, a cached lookup from Tenant A would be served to Tenant B on
/// the next request (RoutedOperations is multi-tenant via a per-request DB
/// context factory - cache values must scope the same way).
///
/// Registered as Scoped so it picks up the correct HttpContext for each
/// request. The underlying <see cref="IMemoryCache"/> is Singleton (per the
/// default <c>AddMemoryCache</c> registration) - the tenant prefix is what
/// enforces isolation, not the wrapper's lifetime.
/// </summary>
public class TenantScopedCache(
    IMemoryCache cache,
    IHttpContextAccessor httpContextAccessor)
{
    public async Task<T> GetOrSetAsync<T>(
        string keyBase,
        TimeSpan ttl,
        Func<Task<T>> factory,
        bool sliding = true)
    {
        var key = BuildKey(keyBase);
        if (cache.TryGetValue<T>(key, out var cached) && cached is not null) return cached;

        var value = await factory();
        var opts = new MemoryCacheEntryOptions();
        if (sliding) opts.SlidingExpiration = ttl; else opts.AbsoluteExpirationRelativeToNow = ttl;
        cache.Set(key, value, opts);
        return value;
    }

    /// <summary>Invalidate a single key (tenant-scoped). Called from write paths.</summary>
    public void Invalidate(string keyBase) => cache.Remove(BuildKey(keyBase));

    private string BuildKey(string keyBase)
    {
        var tenantId = httpContextAccessor.HttpContext?.User
            .FindFirstValue("CurrentTenantID") ?? "anon";
        return $"t{tenantId}:{keyBase}";
    }
}
