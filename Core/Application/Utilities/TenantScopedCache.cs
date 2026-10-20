using System.Collections.Concurrent;
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
///
/// 2026-09-17 audit fixes:
///   * Non-HTTP callers (hosted services, warmup, cron) used to fall
///     through to a literal "anon" tenant id, sharing a single cache
///     slot across all tenants. Now throws so the caller can either
///     supply a tenant id explicitly or skip the cache entirely.
///   * GetOrSetAsync now serialises concurrent cache misses per key
///     via a SemaphoreSlim registry, so a burst of readers hitting a
///     cold entry runs the factory once instead of N times.
/// </summary>
public class TenantScopedCache(
    IMemoryCache cache,
    IHttpContextAccessor httpContextAccessor)
{
    // Per-cache-key semaphores so two concurrent misses on the same
    // key wait on the same lock and re-check the cache on entry.
    // Static so it survives the Scoped lifetime of TenantScopedCache
    // (the underlying IMemoryCache is also Singleton, so this pairing
    // is correct).
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> KeyLocks = new();

    public async Task<T> GetOrSetAsync<T>(
        string keyBase,
        TimeSpan ttl,
        Func<Task<T>> factory,
        bool sliding = true)
    {
        // Non-HTTP callers (hosted services, warmup, cron) have no
        // tenant claim to key on. Bypass the cache entirely and just
        // run the factory - safer than sharing a single "anon" slot
        // across every tenant. Audit CRITICAL #1 (2026-09-17).
        var key = TryBuildKey(keyBase);
        if (key == null) return await factory().ConfigureAwait(false);

        if (cache.TryGetValue<T>(key, out var cached) && cached is not null) return cached;

        // Cold cache. Serialise the fill so N concurrent misses share
        // a single factory run instead of thundering the DB.
        var gate = KeyLocks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync().ConfigureAwait(false);
        try
        {
            // Re-check inside the lock in case a peer filled it while
            // we were waiting.
            if (cache.TryGetValue<T>(key, out var refetched) && refetched is not null) return refetched;

            var value = await factory().ConfigureAwait(false);
            var opts = new MemoryCacheEntryOptions();
            if (sliding) opts.SlidingExpiration = ttl; else opts.AbsoluteExpirationRelativeToNow = ttl;
            cache.Set(key, value, opts);
            return value;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Invalidate a single key (tenant-scoped). Called from write paths.</summary>
    public void Invalidate(string keyBase)
    {
        var key = TryBuildKey(keyBase);
        if (key != null) cache.Remove(key);
    }

    /// <summary>
    /// Replace a cached value in place, under the SAME per-key lock the fill
    /// uses, when and only when the key is already populated. Returns true if
    /// the entry was rewritten.
    ///
    /// For a write path that would otherwise call <see cref="Invalidate"/>:
    /// dropping the key makes the next reader pay for a full rebuild, and if
    /// the writer's own locks are still settling that rebuild blocks on them.
    /// Patching the one changed item keeps the entry warm, so the reader never
    /// pays, and the operator still sees their own write immediately.
    ///
    /// A miss is NOT an error and does not fill the key: there is nothing to
    /// patch, and the next read will build it from scratch anyway. Taking the
    /// lock is what stops a patch racing a concurrent fill and being lost.
    ///
    /// `ttl` and `sliding` must match the fill's, since rewriting the entry
    /// resets its expiry.
    /// </summary>
    public async Task<bool> TryPatchAsync<T>(
        string keyBase,
        TimeSpan ttl,
        Func<T, Task<T>> patch,
        bool sliding = true)
    {
        var key = TryBuildKey(keyBase);
        if (key == null) return false;
        if (!cache.TryGetValue<T>(key, out var current) || current is null) return false;

        var gate = KeyLocks.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync().ConfigureAwait(false);
        try
        {
            // Re-read inside the lock: a peer may have filled or dropped it
            // while we waited, and patching a stale snapshot would undo them.
            if (!cache.TryGetValue<T>(key, out var latest) || latest is null) return false;

            var updated = await patch(latest).ConfigureAwait(false);
            if (updated is null) return false;

            var opts = new MemoryCacheEntryOptions();
            if (sliding) opts.SlidingExpiration = ttl; else opts.AbsoluteExpirationRelativeToNow = ttl;
            cache.Set(key, updated, opts);
            return true;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// Returns the tenant-scoped key when an HTTP context with a valid
    /// tenant claim exists, or null otherwise. Callers should treat null
    /// as "cache bypass" - avoids ever writing/reading a shared "anon"
    /// slot across tenants.
    /// </summary>
    private string? TryBuildKey(string keyBase)
    {
        var tenantId = httpContextAccessor.HttpContext?.User
            .FindFirstValue("CurrentTenantID");
        if (string.IsNullOrEmpty(tenantId)) return null;
        return $"t{tenantId}:{keyBase}";
    }
}
