// Implementation of INpScopeResolver. Reads claims off HttpContext and
// falls back to a single-row TucClient lookup when the NpAgentId claim
// is absent (legacy Hub tokens may not stamp it). The result is cached
// per-request in HttpContext.Items so downstream service / SP invocations
// do not re-run the DB fallback.
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RoutedOperations.Core.Domain;

namespace RoutedOperations.Core.Application.Services.Np;

public class NpScopeResolver(
    IHttpContextAccessor httpContextAccessor,
    IDbContextFactory<DynamicDespatchDbContext> contextFactory) : INpScopeResolver
{
    private const string CacheKey = "NpScope";

    public async Task<NpScope> ResolveAsync()
    {
        var http = httpContextAccessor.HttpContext
            ?? throw new InvalidOperationException("No HttpContext - INpScopeResolver requires a request scope.");

        // Per-request cache. HttpContext.Items goes away at end of request
        // so multi-request lifetime is safe.
        if (http.Items.TryGetValue(CacheKey, out var cached) && cached is NpScope prior)
            return prior;

        // Rule 1: DF admin trumps everything.
        var clientTypeId = http.User.Claims.FirstOrDefault(x => x.Type == "ClientTypeId")?.Value;
        if (string.Equals(clientTypeId, "5", StringComparison.Ordinal))
        {
            var adminScope = new NpScope(IsAdmin: true, NpAgentId: null);
            http.Items[CacheKey] = adminScope;
            return adminScope;
        }

        // Rule 2: tenant staff (not an NP portal login) - full read scope.
        var isNpClaim = http.User.Claims.FirstOrDefault(x => x.Type == "IsNetworkPartner")?.Value;
        var isNp = string.Equals(isNpClaim, "True", StringComparison.OrdinalIgnoreCase);
        if (!isNp)
        {
            var staffScope = new NpScope(IsAdmin: true, NpAgentId: null);
            http.Items[CacheKey] = staffScope;
            return staffScope;
        }

        // Rule 3: NP user. Prefer the direct NpAgentId claim; fall back to
        // TucClient.NpAgentId lookup if the claim is missing (legacy Hub
        // tokens do not carry it).
        var npAgentIdClaim = http.User.Claims.FirstOrDefault(x => x.Type == "NpAgentId")?.Value;
        if (int.TryParse(npAgentIdClaim, out var claimAgentId))
        {
            var npScope = new NpScope(IsAdmin: false, NpAgentId: claimAgentId);
            http.Items[CacheKey] = npScope;
            return npScope;
        }

        var clientIdClaim = http.User.Claims.FirstOrDefault(x => x.Type == "ClientID")?.Value;
        if (int.TryParse(clientIdClaim, out var clientId))
        {
            await using var context = await contextFactory.CreateDbContextAsync();
            var fallbackAgentId = await context.TucClients
                .Where(c => c.UcclId == clientId)
                .Select(c => c.NpAgentId)
                .FirstOrDefaultAsync();
            if (fallbackAgentId.HasValue)
            {
                var fallbackScope = new NpScope(IsAdmin: false, NpAgentId: fallbackAgentId);
                http.Items[CacheKey] = fallbackScope;
                return fallbackScope;
            }
        }

        // Rule 4: degenerate - NP flag set but no agent linkage. IsAdmin
        // stays false + NpAgentId null; every SP call filtered by
        // @NpAgentId = null will return no rows, which is the safest
        // outcome for a cross-tenant claim leak.
        var emptyScope = new NpScope(IsAdmin: false, NpAgentId: null);
        http.Items[CacheKey] = emptyScope;
        return emptyScope;
    }
}
