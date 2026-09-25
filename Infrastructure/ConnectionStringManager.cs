using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Serilog;

namespace RoutedOperations.Infrastructure;

/// <summary>
/// Two-level (memory + Redis) cache for tenant Despatch DB connection strings.
/// Ported from the Configurator implementation; identical semantics so the
/// shared session between apps works out of the box.
/// </summary>
public class ConnectionStringManager(
    IDistributedCache distributedCache,
    IMemoryCache memoryCache)
    : IConnectionStringManager
{
    private static readonly SemaphoreSlim Semaphore = new(1, 1);
    private static readonly TimeSpan CacheSlidingExpiry = TimeSpan.FromHours(8);
    private const int MaxRetryAttempts = 3;
    private static readonly TimeSpan InitialRetryDelay = TimeSpan.FromMilliseconds(100);

    public async Task SetConnectionStringAsync(string tenantAppCacheKey, string connectionString)
    {
        if (string.IsNullOrEmpty(connectionString))
            throw new ArgumentNullException(nameof(connectionString));

        SetMemoryCache(tenantAppCacheKey, connectionString);

        await Semaphore.WaitAsync();
        try
        {
            var options = new DistributedCacheEntryOptions
            {
                SlidingExpiration = CacheSlidingExpiry
            };
            await distributedCache.SetStringAsync(tenantAppCacheKey, connectionString, options);
            Log.Debug("Connection string set in distributed cache for {CacheKey}", tenantAppCacheKey);
        }
        catch (Exception ex)
        {
            Log.Warning(ex,
                "Failed to set connection string in distributed cache for {CacheKey}; memory cache fallback in use",
                tenantAppCacheKey);
        }
        finally
        {
            Semaphore.Release();
        }
    }

    public async Task<string?> GetConnectionStringAsync(string tenantAppCacheKey)
    {
        if (memoryCache.TryGetValue(tenantAppCacheKey, out string? cached) && !string.IsNullOrEmpty(cached))
        {
            Log.Debug("Connection string retrieved from memory cache for {CacheKey}", tenantAppCacheKey);
            return cached;
        }

        var connectionString = await GetFromDistributedCacheWithRetryAsync(tenantAppCacheKey);
        if (!string.IsNullOrEmpty(connectionString))
        {
            SetMemoryCache(tenantAppCacheKey, connectionString);
            return connectionString;
        }

        Log.Warning("Connection string not found in any cache for {CacheKey}", tenantAppCacheKey);
        return null;
    }

    private async Task<string?> GetFromDistributedCacheWithRetryAsync(string tenantAppCacheKey)
    {
        var retryDelay = InitialRetryDelay;

        for (var attempt = 1; attempt <= MaxRetryAttempts; attempt++)
        {
            await Semaphore.WaitAsync();
            try
            {
                var value = await distributedCache.GetStringAsync(tenantAppCacheKey);
                if (!string.IsNullOrEmpty(value))
                {
                    Log.Debug("Connection string retrieved from distributed cache for {CacheKey} on attempt {Attempt}",
                        tenantAppCacheKey, attempt);
                    return value;
                }

                if (attempt == 1)
                    Log.Debug("Connection string not found in distributed cache for {CacheKey}", tenantAppCacheKey);
                return null;
            }
            catch (Exception ex) when (attempt < MaxRetryAttempts)
            {
                Log.Warning(ex,
                    "Transient Redis error for {CacheKey}, attempt {Attempt}/{Max}. Retry in {Delay}ms",
                    tenantAppCacheKey, attempt, MaxRetryAttempts, retryDelay.TotalMilliseconds);
                await Task.Delay(retryDelay);
                retryDelay *= 2;
            }
            catch (Exception ex)
            {
                Log.Error(ex,
                    "Failed to retrieve connection string from distributed cache for {CacheKey} after {Max} attempts",
                    tenantAppCacheKey, MaxRetryAttempts);
                return null;
            }
            finally
            {
                Semaphore.Release();
            }
        }

        return null;
    }

    private void SetMemoryCache(string tenantAppCacheKey, string connectionString)
    {
        var options = new MemoryCacheEntryOptions
        {
            SlidingExpiration = CacheSlidingExpiry,
            Priority = CacheItemPriority.High
        };
        memoryCache.Set(tenantAppCacheKey, connectionString, options);
    }
}
