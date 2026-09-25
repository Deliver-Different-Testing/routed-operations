using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoutedOperations.Core.Domain;
using Serilog;
using RoutedOperations.Core.Application.Utilities;

namespace RoutedOperations.Infrastructure;

/// <summary>
/// Per-request DbContext factory that reads the tenant id from the shared
/// cookie's claims and resolves the tenant's Despatch connection string
/// from the connection-string cache. Ported from the Configurator so the
/// cache key + claim name stay aligned across the DFRNT app suite.
/// </summary>
public class DynamicDespatchDbContextFactory(
    IOptions<DbContextOptions<DespatchContext>> options,
    IConnectionStringManager connectionStringManager,
    IHttpContextAccessor contextAccessor)
    : IDbContextFactory<DespatchContext>
{
    private readonly DbContextOptions<DespatchContext> _options = options.Value;

    public const string OverrideTenantIdItemsKey = "OverrideTenantId";

    public DespatchContext CreateDbContext()
    {
        var httpContext = contextAccessor.HttpContext;
        string? tenantId;
        bool isAuthenticated;

        var overrideTenantId = httpContext?.Items[OverrideTenantIdItemsKey] as string;
        if (!string.IsNullOrEmpty(overrideTenantId))
        {
            tenantId = overrideTenantId;
            isAuthenticated = true;
        }
        else
        {
            isAuthenticated = httpContext?.User.Identity?.IsAuthenticated ?? false;
            tenantId = httpContext?.User.Claims.FirstOrDefault(x => x.Type == "CurrentTenantID")?.Value;

            if (httpContext == null)
            {
                Log.Warning("CreateDbContext called without HttpContext - no authentication context available");
            }
            else if (!isAuthenticated)
            {
                Log.Warning("CreateDbContext called with unauthenticated request. Path: {Path}",
                    httpContext.Request.Path);
            }
            else if (string.IsNullOrEmpty(tenantId))
            {
                Log.Warning(
                    "CreateDbContext called with authenticated user but missing CurrentTenantID claim. Path: {Path}, User: {User}",
                    httpContext.Request.Path,
                    httpContext.User.Identity?.Name ?? "unknown");
            }
        }

        var cacheKey = TenantConnectionCache.Key(tenantId);
        var connectionString = connectionStringManager.GetConnectionStringAsync(cacheKey).GetAwaiter().GetResult();

        if (string.IsNullOrEmpty(connectionString))
        {
            // Transitional: sessions seeded under the old shared key before this app
            // owned its own. ApplyOwnCredentials below makes reading it safe.
            connectionString = connectionStringManager
                .GetConnectionStringAsync(TenantConnectionCache.LegacyKey(tenantId)).GetAwaiter().GetResult();
        }

        if (string.IsNullOrEmpty(connectionString))
        {
            Log.Error(
                "Connection string is not set. CacheKey: {CacheKey}, IsAuthenticated: {IsAuthenticated}, TenantId: {TenantId}",
                cacheKey, isAuthenticated, tenantId ?? "null");
            throw new InvalidOperationException(
                $"Connection string is not set. TenantId: {tenantId ?? "null"}, IsAuthenticated: {isAuthenticated}");
        }

        // Always connect as ourselves, whichever app last wrote the entry we read.
        connectionString = TenantConnectionCache.ApplyOwnCredentials(connectionString);

        var optionsBuilder = new DbContextOptionsBuilder<DespatchContext>(_options);
        optionsBuilder.UseSqlServer(connectionString);

        return new DynamicDespatchDbContext(optionsBuilder.Options);
    }
}

/// <summary>
/// Adapter so BaseService can depend on IDbContextFactory&lt;DynamicDespatchDbContext&gt;
/// while the underlying factory produces the base DespatchContext type.
/// </summary>
public class DynamicDespatchDbContextFactoryAdapter(IDbContextFactory<DespatchContext> inner)
    : IDbContextFactory<DynamicDespatchDbContext>
{
    public DynamicDespatchDbContext CreateDbContext()
    {
        var context = inner.CreateDbContext();
        if (context is DynamicDespatchDbContext dynamic)
            return dynamic;
        throw new InvalidOperationException("Expected DynamicDespatchDbContext but got DespatchContext.");
    }
}
